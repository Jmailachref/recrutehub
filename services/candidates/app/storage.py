"""CV files in the S3 bucket (SeaweedFS in development)."""

import os
from functools import lru_cache

import boto3
from botocore.config import Config


@lru_cache
def _client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_URL", "http://s3:8333"),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY", ""),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY", ""),
        region_name="us-east-1",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def bucket() -> str:
    return os.environ.get("S3_BUCKET", "cvs")


def put_pdf(key: str, data: bytes) -> None:
    _client().put_object(Bucket=bucket(), Key=key, Body=data, ContentType="application/pdf")


def get_pdf(key: str) -> bytes:
    return _client().get_object(Bucket=bucket(), Key=key)["Body"].read()


def delete(key: str) -> None:
    _client().delete_object(Bucket=bucket(), Key=key)
