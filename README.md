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
| cvanalyzer-api, cvanalyzer-worker | [CV Analyzer](https://github.com/Jmailachref/cv-analyzer): reads each CV (OCR for scans) and scores it in points against its offer's grid | none |
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
and [CV Analyzer](https://github.com/Jmailachref/cv-analyzer) next to this repo
(`../code-playground`, `../cv-analyzer`) if they are not there, builds its
sandbox images when any is missing, starts every container and loads the
sample coding problems. Then open http://localhost.

Sign in with the development admin, `admin@example.com` / `admin1234`
(created on start; change it with `BOOTSTRAP_ADMIN_EMAIL` and
`BOOTSTRAP_ADMIN_PASSWORD`). Admins add their team on the Team page. To create
another company and its admin:

```sh
docker compose exec auth python -m app.bootstrap "Acme" admin@acme.com 'a long password'
```

Set `GATEWAY_PORT` to use another port than 80, `CODEPLAY_SOURCE` and
`CV_ANALYZER_SOURCE` to build Code Playground or CV Analyzer from another folder, and `PUBLIC_URL` to the address
candidates open their test links at (default `http://localhost`).

Check a running stack: `sh e2e/smoke.sh http://localhost`.

## Offers

The dashboard lists the offers as cards (active and archived tabs) with their
candidates and scored tests. **New Offer** is one page in three parts:

1. **The job**: the title and description candidates see on the apply page,
   and the skills (the languages and topics of the question bank), each with a
   priority: P1 core, P2 important, P3 secondary are tested; P4 CV only and P5
   bonus are only looked for in the CV.
2. **The test**: **Build the test from the skills** shares 20 questions 3:2:1
   between P1, P2 and P3 skills, at the level closest to 3 that has questions,
   about 60% QCM and 40% code, within what Code Playground has. The recruiter
   then changes any level or count. Each candidate's questions are drawn by
   Code Playground when they are invited.
3. **CV scoring**: a line per selected skill at its level (P1 Essential to
   P5 Bonus), filled in as skills are picked. The level sets the points if
   found and if missing; the recruiter changes the level, the points and the
   words that count, removes lines and adds other competences (see CV points
   below).

**Publish the offer** opens its apply link (`/apply/<token>`); **Save as
draft** keeps it closed; archiving closes it. Offers nobody applied to can be
deleted.

The offer page shows the apply link, the counts (applied, invited, submitted,
scored), the test recipe, the CV scoring and the candidates ranked by test score,
then CV points; each one opens to their CV, scores and every answer.

## CV points

Each CV is scored in points against its offer's **CV scoring**, built from the
skills: a competence the CV shows earns P1 +1, P2 +0.5, P3 +0.1, P4 +0.5,
P5 +0.1, and a missing core skill (P1) costs 20. Each competence counts once,
however often the CV mentions it. **Edit the CV scoring** on the offer page changes
the words that count for each competence (other words, synonyms on or off) and
its points, and adds competences (the same lines as the offer form's CV
scoring); every CV of the offer is scored again.
Changing the offer's skills later keeps the lines edited there; **Build from
the skills again** drops the edits.

On a candidate's page, recruiters select a passage of the CV (or click a line
of the text read, for a scanned CV) and give it from −100 to +100 points with
a comment. Negative points mark a red flag (a former employer the company can
no longer hire from, say) and show in red. A passage counts once: one already
scored, overlapping, or the same text elsewhere in the CV is refused. A CV's
points are the grid's points plus every recruiter's points, with no limit.

CV Analyzer does the reading and scoring: the candidates service sends it each
CV once applied (job `send_cv`, and for older CVs the first time they are
listed), the offers service sends it each offer's title and skills, and both
pass the recruiters' requests through, so the browser never calls it.

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

Locally every email lands in Mailpit (port 8025) and nothing is really sent.
To send real emails, set these before starting, for example in a `.env` file
next to `docker-compose.yml`:

```sh
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_STARTTLS=true
SMTP_USER=you@gmail.com
SMTP_PASSWORD=<an app password, not your account password>
MAIL_FROM=RecruteHub <you@gmail.com>
```

Emails go through the notifications worker: other services queue a
`send_email` job, the worker sends it over SMTP, retrying 3 times, and logs it
(admins read the log at `/api/notifications/emails`).

## Layout

```
docker-compose.yml        every container
gateway/nginx.conf        routes /api/<service>/ to the backends, hides /internal/
frontend/                 Next.js app
libs/common/              shared Python package rh_common: app factory, tokens,
                          errors, database session, Redis queues, Code
                          Playground and CV Analyzer clients
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
development only. In production set `SERVICE_SECRET`, `CV_ANALYZER_KEY`, `BOOTSTRAP_ADMIN_PASSWORD`
(or create admins with the command above) and `COOKIE_SECURE=true`.
