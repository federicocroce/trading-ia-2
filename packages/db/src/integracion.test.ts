import { afterEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./integracion.js";

/** 15/9: un test de integración corrido contra la base de la app borró el registro de uso real. */
describe("base de los tests de integración", () => {
  const antes = process.env["TEST_DATABASE_URL"];
  afterEach(() => {
    if (antes === undefined) delete process.env["TEST_DATABASE_URL"];
    else process.env["TEST_DATABASE_URL"] = antes;
  });

  it("se niega a correr contra la base de la app", () => {
    process.env["TEST_DATABASE_URL"] = "postgres://thesis:thesis@localhost:5433/thesis";
    expect(() => testDatabaseUrl()).toThrow(/base de la app/);
  });
  it("con la base de tests, la usa; sin ninguna, los tests quedan en skip", () => {
    process.env["TEST_DATABASE_URL"] = "postgres://thesis:thesis@localhost:5433/thesis_test";
    expect(testDatabaseUrl()).toMatch(/thesis_test$/);
    delete process.env["TEST_DATABASE_URL"];
    expect(testDatabaseUrl()).toBeNull();
  });
});
