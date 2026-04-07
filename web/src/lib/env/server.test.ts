import { describe, it, expect } from "vitest";
import { validateServerEnv } from "./server";

const VALID_ENV = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  OPENAI_API_KEY: "sk-test",
  ELEVENLABS_API_KEY: "el-test",
  RESEND_API_KEY: "re_test",
};

describe("validateServerEnv", () => {
  it("passes with all required vars", () => {
    const env = validateServerEnv(VALID_ENV);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(env.OPENAI_API_KEY).toBe("sk-test");
    expect(env.ELEVENLABS_API_KEY).toBe("el-test");
    expect(env.RESEND_API_KEY).toBe("re_test");
  });

  it("applies defaults for optional vars", () => {
    const env = validateServerEnv(VALID_ENV);
    expect(env.EMAIL_FROM).toBe("MediTalk <team@meditalk.ai>");
    expect(env.ADMIN_EMAILS).toBe("");
    expect(env.NODE_ENV).toBe("development");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it("accepts SUPABASE_SERVICE_ROLE_KEY when provided", () => {
    const env = validateServerEnv({
      ...VALID_ENV,
      SUPABASE_SERVICE_ROLE_KEY: "sbp_test_key",
    });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("sbp_test_key");
  });

  it("throws when required vars are missing", () => {
    expect(() => validateServerEnv({})).toThrow(
      "Invalid server environment variables",
    );
  });

  it("lists all missing vars in the error message", () => {
    try {
      validateServerEnv({});
      expect.fail("Should have thrown");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("ANTHROPIC_API_KEY");
      expect(message).toContain("OPENAI_API_KEY");
      expect(message).toContain("ELEVENLABS_API_KEY");
      expect(message).toContain("RESEND_API_KEY");
    }
  });

  it("throws for a single missing required var", () => {
    const partial = { ...VALID_ENV };
    delete (partial as Record<string, unknown>).ANTHROPIC_API_KEY;
    expect(() => validateServerEnv(partial)).toThrow("ANTHROPIC_API_KEY");
  });

  it("rejects invalid NODE_ENV", () => {
    expect(() =>
      validateServerEnv({ ...VALID_ENV, NODE_ENV: "staging" }),
    ).toThrow("Invalid server environment variables");
  });

  it("accepts valid NODE_ENV values", () => {
    for (const val of ["development", "production", "test"]) {
      const env = validateServerEnv({ ...VALID_ENV, NODE_ENV: val });
      expect(env.NODE_ENV).toBe(val);
    }
  });
});
