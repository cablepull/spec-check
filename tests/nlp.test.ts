import { describe, expect, it } from "vitest";
import {
  detectCausalLanguage,
  detectImplementationLeak,
  detectCertaintyLanguage,
  detectCompoundTask,
  detectCompoundClause,
} from "../src/nlp.js";

describe("nlp", () => {
  it("R-5 detects causal language in intent text", () => {
    const result = detectCausalLanguage("The problem is inconsistent outputs because the workflow has no gate.");
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("R-6 detects implementation leakage in requirements-style text", () => {
    const result = detectImplementationLeak("The system uses PostgreSQL and React to store and render data.");
    expect(result.matched).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("R-6 does not flag lowercase 'rollup' (aggregation concept) as a framework name", () => {
    const result = detectImplementationLeak("The cross-project rollup answers which model is most disciplined.");
    expect(result.evidence.some((e) => e.includes("rollup"))).toBe(false);
  });

  it("R-6 does not flag lowercase 'express' (verb) as a framework name", () => {
    const result = detectImplementationLeak("The server must express this guidance in machine-readable form.");
    expect(result.evidence.some((e) => e.includes("express"))).toBe(false);
  });

  it("R-6 still flags capitalized framework names Rollup and Express", () => {
    const rollup = detectImplementationLeak("The project bundles assets with Rollup for production.");
    expect(rollup.evidence.some((e) => e.includes("Rollup"))).toBe(true);
    const express = detectImplementationLeak("The API layer is built with Express for routing.");
    expect(express.evidence.some((e) => e.includes("Express"))).toBe(true);
  });

  it("R-6 does not flag public protocol identifiers as implementation leakage", () => {
    const result = detectImplementationLeak("When check_mutation_score is called Then `workflow.must_call_next` is returned by get_next_action.");
    expect(result.matched).toBe(false);
    expect(result.evidence).toEqual([]);
  });

  it("R-24 does not flag hedged assumptions as certainty language", () => {
    const result = detectCertaintyLanguage("Assumed OAuth is used because authentication details were not specified.");
    expect(result.matched).toBe(false);
  });

  it("R-16 flags compound tasks joined by two verb phrases", () => {
    const result = detectCompoundTask("- [ ] Implement parsing and add persistence");
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("R-11 flags compound WHEN-style clauses joined by conjunctions", () => {
    const result = detectCompoundClause("Jane submits the form and the system sends an email");
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });
});
