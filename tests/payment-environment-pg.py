"""Opt-in PostgreSQL integration check: LOCAL_POSTGRES_DSN must target a disposable server.

This script creates and drops its own throwaway database. It never connects to
Supabase or Mercado Pago. Requires psycopg 3 installed by the test operator.
"""

import os
import pathlib
import uuid

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo

root = pathlib.Path(__file__).resolve().parents[1]
dsn = os.environ["LOCAL_POSTGRES_DSN"]
name = "payment_env_" + uuid.uuid4().hex[:12]

admin = psycopg.connect(dsn, autocommit=True)
try:
    if admin.execute("select current_setting('is_superuser')").fetchone()[0] != "on":
        raise RuntimeError("Disposable PostgreSQL superuser required")
    admin.execute(sql.SQL("create database {}").format(sql.Identifier(name)))
    try:
        with psycopg.connect(make_conninfo(dsn, dbname=name)) as db:
            db.execute("create schema auth; create table auth.users(id uuid primary key)")
            for role in ("anon", "authenticated", "service_role"):
                if not db.execute("select 1 from pg_roles where rolname=%s", (role,)).fetchone():
                    db.execute(sql.SQL("create role {}").format(sql.Identifier(role)))
            for path in sorted((root / "supabase" / "migrations").glob("*.sql")):
                db.execute(path.read_text(encoding="utf-8"))

            goal = db.execute("""insert into gifts(name,slug,category,funding_mode,target_amount)
              values ('PG environment isolation','pg-environment-isolation','party','goal',100)
              returning id""").fetchone()[0]
            def contribution(environment, amount, status="pending"):
                return db.execute("""insert into gift_contributions(
                  gift_id,payment_environment,contributor_name,contributor_email,amount,
                  payment_method,payment_status,confirmed_at,idempotency_key,request_fingerprint)
                  values (%s,%s,'Fixture','fixture@example.invalid',%s,'pix',%s,
                    case when %s='confirmed' then now() else null end,
                    gen_random_uuid(),repeat('a',64)) returning id""",
                  (goal, environment, amount, status, status)).fetchone()[0]

            contribution("test", 90, "confirmed")
            production_id = contribution("production", 20)
            assert db.execute("select total_raised from get_gift_progress() where gift_id=%s",
                              (goal,)).fetchone()[0] == 0
            attempt = db.execute("""select id,external_reference,amount,expires_at,payment_environment
              from claim_gift_payment_attempt_for_environment(%s,'production',gen_random_uuid(),30)""",
              (production_id,)).fetchone()
            assert attempt[4] == "production"
            try:
                db.execute("""select reconcile_gift_payment_attempt_for_environment(
                  %s,'test','ORD-PG',null,'processed','accredited',%s,%s,%s,null,null,null)""",
                  (attempt[0], attempt[2], attempt[1], attempt[3]))
                raise AssertionError("cross-environment reconciliation accepted")
            except psycopg.Error as error:
                assert "payment_environment_mismatch" in str(error)
                db.rollback()
            # A failed statement rolls back its transaction; repeat the test
            # setup in a fresh transaction below to verify successful settlement.
        with psycopg.connect(make_conninfo(dsn, dbname=name)) as db:
            goal = db.execute("""insert into gifts(name,slug,category,funding_mode,target_amount)
              values ('PG settlement','pg-settlement','party','goal',100) returning id""").fetchone()[0]
            contribution_id = db.execute("""insert into gift_contributions(
              gift_id,payment_environment,contributor_name,contributor_email,amount,
              payment_method,idempotency_key,request_fingerprint)
              values (%s,'production','Fixture','fixture@example.invalid',20,'pix',
                gen_random_uuid(),repeat('b',64)) returning id""", (goal,)).fetchone()[0]
            attempt = db.execute("""select id,external_reference,amount,expires_at from
              claim_gift_payment_attempt_for_environment(%s,'production',gen_random_uuid(),30)""",
              (contribution_id,)).fetchone()
            status = db.execute("""select reconcile_gift_payment_attempt_for_environment(
              %s,'production','ORD-PG-2',null,'processing','in_process',%s,%s,%s,null,null,null)""",
              (attempt[0], attempt[2], attempt[1], attempt[3])).fetchone()[0]
            assert status == "pending"
            status = db.execute("""select reconcile_gift_payment_attempt_for_environment(
              %s,'production','ORD-PG-2',null,'processed','accredited',%s,%s,%s,null,null,null)""",
              (attempt[0], attempt[2], attempt[1], attempt[3])).fetchone()[0]
            assert status == "confirmed"
            assert db.execute("select total_raised from get_gift_progress() where gift_id=%s",
                              (goal,)).fetchone()[0] == 20
        print("PostgreSQL real: migration and environment isolation passed")
    finally:
        admin.execute(sql.SQL("drop database {} with (force)").format(sql.Identifier(name)))
finally:
    admin.close()
