import { describe, it, expect } from "vitest";
import {
  parseMeasurement,
  checkMeasurementSanity,
  validateMeasurementValue,
} from "./numeric-sanity";

describe("parseMeasurement", () => {
  it("parses Slovak BP with timestamp", () => {
    const p = parseMeasurement("TK 150/80 mmHg (14:02)");
    expect(p).toEqual({
      kind: "bp",
      values: [150, 80],
      unit: "mmHg",
      normalized: "TK 150/80 mmHg",
    });
  });

  it("parses HR (SF)", () => {
    const p = parseMeasurement("SF 68/min");
    expect(p?.kind).toBe("hr");
    expect(p?.values).toEqual([68]);
  });

  it("parses RR (DF)", () => {
    const p = parseMeasurement("DF 16/min");
    expect(p?.kind).toBe("rr");
    expect(p?.values).toEqual([16]);
  });

  it("parses SpO2 (O₂SAT)", () => {
    const p = parseMeasurement("O₂SAT 92%");
    expect(p?.kind).toBe("spo2");
    expect(p?.values).toEqual([92]);
  });

  it("parses SpO2 (SpO2)", () => {
    expect(parseMeasurement("SpO2 98%")?.kind).toBe("spo2");
  });

  it("parses temp with Slovak decimal comma", () => {
    const p = parseMeasurement("Telesná teplota 36,4 °C");
    expect(p?.kind).toBe("temp_c");
    expect(p?.values[0]).toBeCloseTo(36.4);
  });

  it("parses glucose mmol/L with decimal comma", () => {
    const p = parseMeasurement("Glykémia 11,1 mmol/l");
    expect(p?.kind).toBe("glucose_mmol");
    expect(p?.values[0]).toBeCloseTo(11.1);
  });

  it("parses glucose mg/dL when unit explicit", () => {
    const p = parseMeasurement("Glucose 200 mg/dL");
    expect(p?.kind).toBe("glucose_mgdl");
    expect(p?.values).toEqual([200]);
  });

  it("parses GCS without unit", () => {
    expect(parseMeasurement("GCS 15")?.values).toEqual([15]);
  });

  it("parses weight", () => {
    const p = parseMeasurement("Hmotnosť 78 kg");
    expect(p?.kind).toBe("weight_kg");
    expect(p?.values).toEqual([78]);
  });

  it("parses height", () => {
    const p = parseMeasurement("Výška 175 cm");
    expect(p?.kind).toBe("height_cm");
    expect(p?.values).toEqual([175]);
  });

  it("returns null for unrecognized measurement", () => {
    expect(parseMeasurement("nejaká hodnota 42")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseMeasurement("")).toBeNull();
    expect(parseMeasurement("   ")).toBeNull();
  });

  it("returns null when BP pattern has no BP keyword or unit", () => {
    // A bare "150/80" could be many things — don't assume BP
    expect(parseMeasurement("150/80")).toBeNull();
  });

  it("accepts BP with just the unit (no TK/BP prefix)", () => {
    expect(parseMeasurement("150/80 mmHg")?.kind).toBe("bp");
  });
});

describe("checkMeasurementSanity — blood pressure", () => {
  it("accepts normal BP", () => {
    const p = parseMeasurement("TK 120/80 mmHg")!;
    expect(checkMeasurementSanity(p).ok).toBe(true);
  });

  it("flags impossible BP (800/100)", () => {
    const p = parseMeasurement("TK 800/100 mmHg")!;
    const v = checkMeasurementSanity(p);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("impossible");
  });

  it("flags impossible BP (systolic ≤ diastolic)", () => {
    const p = parseMeasurement("TK 80/100 mmHg")!;
    const v = checkMeasurementSanity(p);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.severity).toBe("impossible");
      expect(v.reason).toMatch(/systolic/i);
    }
  });

  it("flags suspicious hypertensive BP (260/150)", () => {
    const p = parseMeasurement("TK 260/160 mmHg")!;
    const v = checkMeasurementSanity(p);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("suspicious");
  });
});

describe("checkMeasurementSanity — heart rate", () => {
  it("accepts normal HR", () => {
    const p = parseMeasurement("SF 68/min")!;
    expect(checkMeasurementSanity(p).ok).toBe(true);
  });

  it("flags impossible HR (350)", () => {
    const p = parseMeasurement("HR 350/min")!;
    const v = checkMeasurementSanity(p);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("impossible");
  });

  it("flags suspicious HR (25)", () => {
    const p = parseMeasurement("SF 25/min")!;
    const v = checkMeasurementSanity(p);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("suspicious");
  });
});

describe("checkMeasurementSanity — SpO2", () => {
  it("accepts normal SpO2", () => {
    expect(checkMeasurementSanity(parseMeasurement("SpO2 98%")!).ok).toBe(true);
  });

  it("flags impossible SpO2 (120%)", () => {
    const v = checkMeasurementSanity(parseMeasurement("SpO2 120%")!);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("impossible");
  });

  it("flags suspicious SpO2 (65%)", () => {
    const v = checkMeasurementSanity(parseMeasurement("SpO2 65%")!);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("suspicious");
  });
});

describe("checkMeasurementSanity — temperature", () => {
  it("accepts normal temp", () => {
    expect(
      checkMeasurementSanity(parseMeasurement("Telesná teplota 36,4 °C")!).ok,
    ).toBe(true);
  });

  it("flags impossible temp (50 °C)", () => {
    const v = checkMeasurementSanity(
      parseMeasurement("Telesná teplota 50 °C")!,
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("impossible");
  });

  it("flags suspicious fever (43 °C)", () => {
    const v = checkMeasurementSanity(
      parseMeasurement("Telesná teplota 43 °C")!,
    );
    expect(v.ok).toBe(false);
    // 43 is outside the impossible range (28–45) → suspicious (34-42 band)
    if (!v.ok) expect(v.severity).toBe("suspicious");
  });
});

describe("checkMeasurementSanity — glucose", () => {
  it("accepts normal mmol/L glucose", () => {
    expect(
      checkMeasurementSanity(parseMeasurement("Glykémia 5,5 mmol/l")!).ok,
    ).toBe(true);
  });

  it("flags impossible mmol/L glucose (111)", () => {
    // 111 mmol/L — way above the 60 ceiling; likely a mg/dL value mislabeled
    const v = checkMeasurementSanity(parseMeasurement("Glykémia 111 mmol/l")!);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("impossible");
  });

  it("accepts mg/dL glucose in diabetic range", () => {
    expect(
      checkMeasurementSanity(parseMeasurement("Glucose 200 mg/dL")!).ok,
    ).toBe(true);
  });
});

describe("checkMeasurementSanity — GCS", () => {
  it("accepts valid GCS 15", () => {
    expect(checkMeasurementSanity(parseMeasurement("GCS 15")!).ok).toBe(true);
  });

  it("flags impossible GCS (20)", () => {
    const v = checkMeasurementSanity(parseMeasurement("GCS 20")!);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("impossible");
  });

  it("flags impossible GCS (2)", () => {
    const v = checkMeasurementSanity(parseMeasurement("GCS 2")!);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("impossible");
  });
});

describe("checkMeasurementSanity — weight / height", () => {
  it("accepts normal weight", () => {
    expect(checkMeasurementSanity(parseMeasurement("Hmotnosť 78 kg")!).ok).toBe(
      true,
    );
  });

  it("flags impossible weight (500 kg)", () => {
    const v = checkMeasurementSanity(parseMeasurement("Hmotnosť 500 kg")!);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("impossible");
  });

  it("flags suspicious weight (270 kg)", () => {
    const v = checkMeasurementSanity(parseMeasurement("Hmotnosť 270 kg")!);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("suspicious");
  });

  it("accepts normal height", () => {
    expect(checkMeasurementSanity(parseMeasurement("Výška 175 cm")!).ok).toBe(
      true,
    );
  });
});

describe("validateMeasurementValue", () => {
  it("returns ok for normal vital", () => {
    const v = validateMeasurementValue("TK 120/80 mmHg (14:02)");
    expect(v.ok).toBe(true);
  });

  it("returns unparseable for non-measurements", () => {
    const v = validateMeasurementValue("bolesť na hrudníku");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("unparseable");
  });

  it("returns impossible for HR 350", () => {
    const v = validateMeasurementValue("HR 350/min");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.severity).toBe("impossible");
  });
});
