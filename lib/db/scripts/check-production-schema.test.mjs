import assert from "node:assert/strict";
import test from "node:test";

import {
  assessAdviceProductionSchema,
  assessBudgetProductionSchema,
  assessLoginActivityProductionSchema,
  assessIncomeReceiptsProductionSchema,
  assessOtpProductionSchema,
  assessPasskeyProductionConfig,
  assessPasskeyProductionSchema,
  assessProductionSchema,
  selectDatabaseVariableName,
} from "./check-production-schema.mjs";

test("accepts complete passkey credential, challenge, and audit storage", () => {
  const columns = (names) => names.map((column_name) => ({ column_name }));
  const assessment = assessPasskeyProductionSchema({
    passkey_credentials: columns([
      "id", "user_id", "name", "public_key", "counter", "transports", "device_type",
      "backed_up", "last_used_at", "revoked_at", "created_at", "updated_at",
    ]),
    passkey_challenges: columns([
      "id", "type", "challenge", "rp_id", "rp_origin", "user_id", "requester_hash",
      "browser_binding_hash", "expires_at", "consumed_at", "created_at",
    ]),
    passkey_audit_events: columns(["id", "user_id", "credential_id", "event", "created_at"]),
    users: columns(["id", "email", "email_verified_at"]),
    sessions: columns(["sid", "sess", "expire"]),
  });
  assert.deepEqual(assessment.missing, []);
});

test("reports incomplete passkey storage", () => {
  const assessment = assessPasskeyProductionSchema({
    passkey_credentials: [],
    passkey_challenges: [],
    passkey_audit_events: [],
    users: [],
    sessions: [],
  });
  assert.equal(assessment.missing.length, 5);
  assert.match(assessment.missing.join(";"), /public_key/);
  assert.match(assessment.missing.join(";"), /consumed_at/);
  assert.match(assessment.missing.join(";"), /credential_id/);
  assert.match(assessment.missing.join(";"), /email_verified_at/);
  assert.match(assessment.missing.join(";"), /sessions missing passkey prerequisite columns/);
});

test("accepts complete passkey and email step-up production configuration", () => {
  assert.deepEqual(assessPasskeyProductionConfig({
    PASSKEY_RP_ID: "example.com",
    PASSKEY_ORIGIN: "https://app.example.com",
    RESEND_API_KEY: "configured",
    AUTH_EMAIL_FROM: "ezyRetire <login@example.com>",
    SESSION_SECRET: "a".repeat(32),
  }).problems, []);
});

test("reports invalid passkey and email step-up production configuration safely", () => {
  const assessment = assessPasskeyProductionConfig({
    PASSKEY_RP_ID: "https://example.com",
    PASSKEY_ORIGIN: "http://other.test/path",
    SESSION_SECRET: "short",
  });
  assert.match(assessment.problems.join(";"), /PASSKEY_RP_ID/);
  assert.match(assessment.problems.join(";"), /PASSKEY_ORIGIN/);
  assert.match(assessment.problems.join(";"), /RESEND_API_KEY/);
  assert.match(assessment.problems.join(";"), /AUTH_EMAIL_FROM/);
  assert.match(assessment.problems.join(";"), /SESSION_SECRET/);
});

test("rejects public-suffix and malformed relying-party IDs before deployment", () => {
  for (const rpID of ["com", "co.uk", "github.io", ".example.com", "example..com"]) {
    const assessment = assessPasskeyProductionConfig({
      PASSKEY_RP_ID: rpID,
      PASSKEY_ORIGIN: `https://app.example.com`,
      RESEND_API_KEY: "configured",
      AUTH_EMAIL_FROM: "ezyRetire <login@example.com>",
      SESSION_SECRET: "a".repeat(32),
    });
    assert.match(assessment.problems.join(";"), /PASSKEY_RP_ID/);
  }
});

const requiredColumns = [
  "id",
  "advice_request_id",
  "event_type",
  "status",
  "attempt_count",
  "provider_message_id",
  "error",
  "created_at",
  "last_attempt_at",
  "completed_at",
].map((column_name) => ({
  column_name,
  data_type: ["created_at", "last_attempt_at", "completed_at"].includes(column_name)
    ? "timestamp without time zone"
    : undefined,
}));

const validIndex = {
  index_name: "whatsapp_notification_request_event_unique",
  is_unique: true,
  column_names: "{advice_request_id,event_type}",
};

const requiredAdviceColumns = [
  "id",
  "user_id",
  "user_name",
  "user_email",
  "whatsapp_number",
  "topic",
  "note",
  "consent",
  "fee_amount",
  "payment_status",
  "payment_reference",
  "payment_submitted_at",
  "status",
  "advisor_id",
  "created_at",
  "updated_at",
].map((column_name) => ({
  column_name,
  data_type: ["payment_submitted_at", "created_at", "updated_at"].includes(column_name)
    ? "timestamp without time zone"
    : undefined,
}));

const validAdviceIndex = {
  index_name: "advice_requests_one_active_per_user",
  is_unique: true,
  column_names: ["user_id"],
  index_expression:
    "CASE WHEN status NOT IN ('completed', 'cancelled') THEN 1 ELSE NULL END",
};

const requiredOtpColumns = [
  "id",
  "email",
  "requester_hash",
  "code_hash",
  "expires_at",
  "delivered_at",
  "consumed_at",
  "failed_attempts",
  "max_attempts",
  "resend_available_at",
  "created_at",
].map((column_name) => ({
  column_name,
  data_type: ["expires_at", "delivered_at", "consumed_at", "resend_available_at", "created_at"].includes(column_name)
    ? "timestamp without time zone"
    : undefined,
}));
const validOtpIndexes = [
  "email_otp_challenges_email_created_idx",
  "email_otp_challenges_requester_created_idx",
  "email_otp_challenges_expires_idx",
].map((index_name) => ({ index_name }));

const requiredBudgetColumns = [
  "id",
  "user_id",
  "category",
  "monthly_limit",
  "details",
  "updated_at",
].map((column_name) => column_name === "details"
  ? {
      column_name,
      data_type: "jsonb",
      is_nullable: "NO",
      column_default: "'{}'::jsonb",
    }
  : { column_name });

const requiredIncomeReceiptColumns = [
  "id", "user_id", "income_source_id", "received_date", "amount", "note",
  "created_at", "updated_at",
].map((column_name) => ({
  column_name,
  data_type: ["created_at", "updated_at"].includes(column_name)
    ? "timestamp without time zone"
    : undefined,
}));
const validIncomeReceiptIndexes = [
  { index_name: "income_receipts_user_date_idx" },
  { index_name: "income_receipts_source_idx" },
];
const validIncomeReceiptConstraints = [{
  constraint_name: "income_receipts_owner_source_fk",
  definition: "FOREIGN KEY (user_id, income_source_id) REFERENCES income_sources(user_id, id) ON DELETE CASCADE",
}];

test("uses DATABASE_URL in the GitHub Actions production-schema environment", () => {
  const ciEnvironment = {
    DATABASE_URL_VARIABLE: "DATABASE_URL",
    DATABASE_URL: "credential-free-test-value",
  };

  const selectedName = selectDatabaseVariableName(ciEnvironment);

  assert.equal(selectedName, "DATABASE_URL");
  assert.equal(ciEnvironment[selectedName], "credential-free-test-value");
});

test("reports the complete required schema when the queue table is missing", () => {
  assert.deepEqual(assessProductionSchema([], []), {
    missingColumns: requiredColumns.map(({ column_name }) => column_name),
    invalidTimestampColumns: [],
    validIndex: false,
  });
});

test("accepts PostgreSQL's textual name[] representation for the required index", () => {
  assert.deepEqual(assessProductionSchema(requiredColumns, [validIndex]), {
    missingColumns: [],
    invalidTimestampColumns: [],
    validIndex: true,
  });
});

test("reports each missing required column", async (t) => {
  for (const { column_name: missingColumn } of requiredColumns) {
    await t.test(missingColumn, () => {
      const columns = requiredColumns.filter(({ column_name }) => column_name !== missingColumn);

      assert.deepEqual(assessProductionSchema(columns, [validIndex]), {
        missingColumns: [missingColumn],
        invalidTimestampColumns: [],
        validIndex: true,
      });
    });
  }
});

test("rejects malformed required index definitions", async (t) => {
  const malformedIndexes = [
    { ...validIndex, is_unique: false },
    { ...validIndex, column_names: "{event_type,advice_request_id}" },
    { ...validIndex, column_names: "{advice_request_id}" },
    { ...validIndex, column_names: "{advice_request_id,event_type,status}" },
  ];

  for (const index of malformedIndexes) {
    await t.test(JSON.stringify(index), () => {
      assert.equal(assessProductionSchema(requiredColumns, [index]).validIndex, false);
    });
  }
});

test("rejects timezone-aware queue timestamps", () => {
  const columns = requiredColumns.map((column) =>
    column.column_name === "created_at"
      ? { ...column, data_type: "timestamp with time zone" }
      : column,
  );

  assert.deepEqual(assessProductionSchema(columns, [validIndex]), {
    missingColumns: [],
    invalidTimestampColumns: ["created_at"],
    validIndex: true,
  });
});

test("accepts the complete payment and active-request schema", () => {
  assert.deepEqual(
    assessAdviceProductionSchema(requiredAdviceColumns, [validAdviceIndex]),
    {
      missingColumns: [],
      invalidTimestampColumns: [],
      validIndex: true,
    },
  );
});

test("reports every missing advice request column", async (t) => {
  for (const { column_name: missingColumn } of requiredAdviceColumns) {
    await t.test(missingColumn, () => {
      const columns = requiredAdviceColumns.filter(
        ({ column_name }) => column_name !== missingColumn,
      );

      assert.deepEqual(
        assessAdviceProductionSchema(columns, [validAdviceIndex]),
        {
          missingColumns: [missingColumn],
          invalidTimestampColumns: [],
          validIndex: true,
        },
      );
    });
  }
});

test("rejects an incomplete active-request uniqueness index", () => {
  const malformedIndexes = [
    { ...validAdviceIndex, is_unique: false },
    { ...validAdviceIndex, column_names: [] },
    { ...validAdviceIndex, index_expression: "status = 'submitted'" },
    { ...validAdviceIndex, index_expression: null },
  ];

  for (const index of malformedIndexes) {
    assert.equal(
      assessAdviceProductionSchema(requiredAdviceColumns, [index]).validIndex,
      false,
    );
  }
});

test("rejects timezone-aware advice timestamps", () => {
  const columns = requiredAdviceColumns.map((column) =>
    column.column_name === "payment_submitted_at"
      ? { ...column, data_type: "timestamp with time zone" }
      : column,
  );

  assert.deepEqual(
    assessAdviceProductionSchema(columns, [validAdviceIndex]),
    {
      missingColumns: [],
      invalidTimestampColumns: ["payment_submitted_at"],
      validIndex: true,
    },
  );
});

test("accepts the complete email OTP production schema", () => {
  assert.deepEqual(
    assessOtpProductionSchema(
      requiredOtpColumns,
      validOtpIndexes,
      [{ column_name: "email_verified_at" }],
    ),
    {
      missingColumns: [],
      missingIndexes: [],
      missingUserColumns: [],
      invalidTimestampColumns: [],
    },
  );
});

test("reports incomplete email OTP storage and verification identity", () => {
  assert.deepEqual(assessOtpProductionSchema([], [], []), {
    missingColumns: requiredOtpColumns.map(({ column_name }) => column_name),
    missingIndexes: validOtpIndexes.map(({ index_name }) => index_name),
    missingUserColumns: ["email_verified_at"],
    invalidTimestampColumns: [],
  });
});

test("accepts the complete login activity production schema", () => {
  const columns = [
    "id", "user_id", "auth_method", "device_type", "browser",
    "operating_system", "country", "region", "city", "created_at",
  ].map((column_name) => ({
    column_name,
    data_type: column_name === "created_at" ? "timestamp without time zone" : "character varying",
  }));
  const indexes = [
    { index_name: "login_activities_created_idx" },
    { index_name: "login_activities_user_created_idx" },
  ];
  assert.deepEqual(assessLoginActivityProductionSchema(columns, indexes), {
    missingColumns: [],
    missingIndexes: [],
    validTimestamp: true,
  });
});

test("reports incomplete login activity storage", () => {
  const assessment = assessLoginActivityProductionSchema([], []);
  assert.ok(assessment.missingColumns.includes("user_id"));
  assert.deepEqual(assessment.missingIndexes, [
    "login_activities_created_idx",
    "login_activities_user_created_idx",
  ]);
  assert.equal(assessment.validTimestamp, false);
});

test("accepts account-scoped income receipt storage", () => {
  assert.deepEqual(
    assessIncomeReceiptsProductionSchema(
      requiredIncomeReceiptColumns,
      validIncomeReceiptIndexes,
      validIncomeReceiptConstraints,
    ),
    {
      missingColumns: [],
      missingIndexes: [],
      invalidTimestampColumns: [],
      validOwnerSourceForeignKey: true,
    },
  );
});

test("rejects income receipts without their account-source ownership guard", () => {
  const assessment = assessIncomeReceiptsProductionSchema([], [], []);
  assert.deepEqual(
    assessment.missingColumns,
    requiredIncomeReceiptColumns.map(({ column_name }) => column_name),
  );
  assert.deepEqual(
    assessment.missingIndexes,
    validIncomeReceiptIndexes.map(({ index_name }) => index_name),
  );
  assert.equal(assessment.validOwnerSourceForeignKey, false);
});

test("accepts the additive lifetime-budget details column", () => {
  assert.deepEqual(assessBudgetProductionSchema(requiredBudgetColumns), {
    missingColumns: [],
    validDetailsColumn: true,
  });
});

test("rejects a missing, nullable, or incorrectly typed budget details column", () => {
  assert.deepEqual(assessBudgetProductionSchema(
    requiredBudgetColumns.filter(({ column_name }) => column_name !== "details"),
  ), {
    missingColumns: ["details"],
    validDetailsColumn: false,
  });

  for (const details of [
    { column_name: "details", data_type: "text", is_nullable: "NO", column_default: "'{}'::jsonb" },
    { column_name: "details", data_type: "jsonb", is_nullable: "YES", column_default: "'{}'::jsonb" },
    { column_name: "details", data_type: "jsonb", is_nullable: "NO", column_default: null },
  ]) {
    assert.equal(assessBudgetProductionSchema([
      ...requiredBudgetColumns.filter(({ column_name }) => column_name !== "details"),
      details,
    ]).validDetailsColumn, false);
  }
});