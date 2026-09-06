import { describe, it, expect } from "vitest";
import {
  cleanNationalNumber,
  isValidNationalNumber,
  toE164,
  isValidOtp,
  nextResendDelay,
  MAX_RESENDS,
  COUNTRIES,
} from "../phoneAuth";

describe("cleanNationalNumber", () => {
  it("strips separators", () => {
    expect(cleanNationalNumber("98765 43210")).toBe("9876543210");
    expect(cleanNationalNumber("(987) 654-3210")).toBe("9876543210");
    expect(cleanNationalNumber("98.76.54")).toBe("987654");
  });
});

describe("isValidNationalNumber — India (+91)", () => {
  it("accepts a valid 10-digit mobile starting 6-9", () => {
    expect(isValidNationalNumber("+91", "9876543210")).toBe(true);
    expect(isValidNationalNumber("+91", "60000 00001")).toBe(true);
  });
  it("rejects landline-style, short, long, and lettered input", () => {
    expect(isValidNationalNumber("+91", "1234567890")).toBe(false); // starts with 1
    expect(isValidNationalNumber("+91", "98765")).toBe(false); // too short
    expect(isValidNationalNumber("+91", "98765432109")).toBe(false); // 11 digits
    expect(isValidNationalNumber("+91", "98765abcde")).toBe(false);
    expect(isValidNationalNumber("+91", "")).toBe(false);
  });
});

describe("isValidNationalNumber — other countries", () => {
  it("uses the E.164 length window", () => {
    expect(isValidNationalNumber("+1", "2025550123")).toBe(true);
    expect(isValidNationalNumber("+44", "7911123456")).toBe(true);
    expect(isValidNationalNumber("+1", "12345")).toBe(false); // too short
    expect(isValidNationalNumber("+1", "1234567890123")).toBe(false); // too long
  });
});

describe("toE164", () => {
  it("builds E.164 with explicit country code", () => {
    expect(toE164("+91", "98765 43210")).toBe("+919876543210");
  });
  it("returns null for invalid input, never guesses", () => {
    expect(toE164("+91", "12345")).toBeNull();
    expect(toE164("91", "9876543210")).toBeNull(); // dial must be +NN
    expect(toE164("+9999", "9876543210")).toBeNull(); // dial too long
    expect(toE164("+91", "hello")).toBeNull();
  });
});

describe("isValidOtp", () => {
  it("accepts exactly 6 digits", () => {
    expect(isValidOtp("123456")).toBe(true);
    expect(isValidOtp(" 123456 ")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isValidOtp("12345")).toBe(false);
    expect(isValidOtp("1234567")).toBe(false);
    expect(isValidOtp("12345a")).toBe(false);
    expect(isValidOtp("")).toBe(false);
  });
});

describe("nextResendDelay", () => {
  it("escalates and then exhausts the send budget", () => {
    expect(nextResendDelay(1)).toBe(30); // initial send
    expect(nextResendDelay(2)).toBe(60); // resend 1
    expect(nextResendDelay(3)).toBe(120); // resend 2
    expect(nextResendDelay(4)).toBe(180); // resend 3 (last)
    expect(nextResendDelay(MAX_RESENDS + 2)).toBeNull(); // out of budget
  });
});

describe("COUNTRIES", () => {
  it("all dial codes are unique and E.164-shaped", () => {
    const dials = COUNTRIES.map((c) => c.dial);
    expect(new Set(dials).size).toBe(dials.length);
    for (const d of dials) expect(d).toMatch(/^\+[0-9]{1,3}$/);
  });
});
