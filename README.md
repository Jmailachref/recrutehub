# RecruteHub

Recruitment platform: recruiters publish offers, candidates apply with a CV,
take a generated test (code and QCM), and get scored and ranked.

Everything runs in Docker. The architecture doc explains the design:
https://claude.ai/code/artifact/b16a2ca9-0420-494d-8116-6f9f261ca0e7

## Containers

| Container | What it does | Local port |
|---|---|---|
| gateway | nginx, the only public entry point | 80 |
| frontend | Next.js app | via gateway |
| auth, offers, questions, candidates, assessments, notifications | FastAPI backends, one database each | via gateway at `/api/<service>/` |
| questions-worker, candidates-worker, assessments-worker, notifications-worker | background jobs from Redis queues | none |
| codeplay-api, codeplay-worker | Code Playground: question bank, test generation, code judging | 8000 (localhost) |
| postgres | one database and user per service | none |
| redis | job queues | none |
| s3 | SeaweedFS, S3-compatible storage for CVs (bucket `cvs`) | 8888 file browser |
| mailpit | catches every email sent locally | 8025 inbox |

Each backend's API docs are at `/api/<service>/docs`, for example
http://localhost/api/offers/docs.

## Run it

In a Codespace it starts by itself. Anywhere else with Docker:

```sh
sh scripts/start.sh
```

The script checks out [Code Playground](https://github.com/Jmailachref/code-playground)
next to this repo (`../code-playground`) if it is not there, builds its
sandbox images when any is missing, starts every container and loads the
sample coding problems. Then open http://localhost.

Sign in with the development admin, `admin@example.com` / `admin1234`
(created on start; change it with `BOOTSTRAP_ADMIN_EMAIL` and
`BOOTSTRAP_ADMIN_PASSWORD`). Admins add their team on the Team page. To create
another company and its admin:

```sh
docker compose exec auth python -m app.bootstrap "Acme" admin@acme.com 'a long password'
```

Set `GATEWAY_PORT` to use another port than 80, `CODEPLAY_SOURCE` to
build Code Playground from another folder, and `PUBLIC_URL` to the address
candidates open their test links at (default `http://localhost`).

Check a running stack: `sh e2e/smoke.sh http://localhost`.

## Offers

A recruiter creates an offer, then sets its test: for each language or topic
and level, how many code and QCM questions (for example Python level 5: 4 code
and 1 QCM; Docker level 2: 6 QCM). The editor only offers counts the question
bank in Code Playground can fill. Publishing opens the offer's apply link
(`/apply/<token>`); archiving closes it. Each candidate's questions are drawn
by Code Playground when they are invited.

## Applications

The apply page shows the offer and takes a name, an email, an optional phone
and a CV (PDF, 10 MB at most). The CV goes to the `cvs` bucket as
`<company>/<offer>/<candidate>.pdf`, and the candidate gets a confirmation
email (open http://localhost:8025 to read it locally). One email can apply once
per offer, and one address can send 10 applications an hour. Recruiters see
the applications under **Candidates**, filtered by offer, and open each CV.

## Candidate tests

From **Candidates**, a recruiter invites an applicant to the test. Code
Playground draws their questions from the offer's recipe (questions this
company already used come last) and freezes them, and the candidate gets an
email with a link that works for 7 days. The link carries a candidate token
in its `#fragment`, so it never reaches a server log; it opens that one test
only.

The candidate sees an overview, then starts the clock: they get the sum of
the questions' timers, in one block. Answers save as they type; code
questions run against their visible examples in the sandbox (20 runs a
minute). Submitting, or running out of time, ends the test. The assessments
worker then judges each code answer against all its test cases, hidden ones
included, and checks the QCM answers (all right options and no wrong one).

Scores are percentages: practice is the average code score (share of test
cases passed), theory the share of QCM answered right, and the total weighs
them with the offer's weights. Candidates are ranked by total, and each test
opens to every answer with its verdict.

Emails go through the notifications worker: other services queue a
`send_email` job, the worker sends it over SMTP, retrying 3 times, and logs it
(admins read the log at `/api/notifications/emails`).

## Layout

```
docker-compose.yml        every container
gateway/nginx.conf        routes /api/<service>/ to the backends, hides /internal/
frontend/                 Next.js app
libs/common/              shared Python package rh_common: app factory, tokens,
                          errors, database session, Redis queues
services/<name>/          one backend: app/, migrations/ (Alembic), tests/, Dockerfile
postgres/                 creates the per-service databases on first start
s3/                       storage credentials (development only)
e2e/                      checks run against the whole stack
```

## Rules every backend follows

- Routes are declared without the `/api/<service>` prefix; the gateway strips it.
- Routes under `/internal/` are for other services only. The gateway never forwards them.
- Errors use one format: `{"error": {"code": "...", "message": "..."}}`.
- Callers are identified by RS256 JWTs signed by auth (`rh_common.tokens`): the
  browser sends them in the httpOnly `rh_access` cookie, other callers as a
  Bearer header. Roles: `admin`, `editor`, `recruiter`, `candidate`, `service`.
- Access tokens last 15 minutes; the `rh_refresh` cookie renews them and works
  once. Reusing a spent refresh token signs that user out everywhere.
- Services call each other's `/internal/` routes with a 5-minute service token,
  which auth gives in exchange for `SERVICE_SECRET`.
- Migrations run on every start (`alembic upgrade head`).

## Tests

```sh
pip install ./libs/common pytest
cd services/offers && python -m pytest -q
```

The passwords and secrets in `docker-compose.yml` and `s3/s3.json` are for
development only. In production set `SERVICE_SECRET`, `BOOTSTRAP_ADMIN_PASSWORD`
(or create admins with the command above) and `COOKIE_SECURE=true`.
