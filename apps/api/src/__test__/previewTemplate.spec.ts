import { describe, it } from "vitest";
import { expect } from "chai";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  SAFE_TEMPLATE_NAME,
  localMigrations,
  migrationsFit,
  retarget,
} from "../custom_modules/preview/templateDatabase";
import { run as runDatabaseCli } from "../custom_modules/preview/databaseCli";

const TPL = "preview_tpl_0123456789ab_abc1234";

describe("Preview template databases", function () {
  it("retargets definitions: drops DEFINER and points schema references at the copy", function () {
    const view =
      "CREATE ALGORITHM=UNDEFINED DEFINER=`preview`@`%` SQL SECURITY DEFINER VIEW `Regrant_allocations` AS " +
      `select \`${TPL}\`.\`Donations\`.\`ID\` AS \`Donation_ID\` from \`${TPL}\`.\`Donations\``;
    const out = retarget(view, TPL, "preview_pr_12");
    expect(out).to.not.include("DEFINER=");
    expect(out).to.not.include(TPL);
    expect(out).to.include("`preview_pr_12`.`Donations`.`ID`");
    expect(out).to.include("SQL SECURITY DEFINER VIEW");

    const trigger =
      "CREATE DEFINER=`preview`@`%` TRIGGER `t` BEFORE INSERT ON `Donations` FOR EACH ROW SET NEW.x = 1";
    expect(retarget(trigger, TPL, "preview_pr_12")).to.equal(
      "CREATE TRIGGER `t` BEFORE INSERT ON `Donations` FOR EACH ROW SET NEW.x = 1",
    );
  });

  it("only uses a template whose migrations all exist locally", function () {
    const local = new Set(["001_a", "002_b", "003_pr_only"]);
    expect(migrationsFit(["001_a", "002_b"], local)).to.equal(true);
    expect(migrationsFit(["001_a", "002_b", "004_newer_on_main"], local)).to.equal(false);
    expect(migrationsFit(["001_a", "002_b"], local, true)).to.equal(false);
    expect(migrationsFit(["001_a", "002_b", "003_pr_only"], local, true)).to.equal(true);
  });

  it("lists migration folders that contain a migration.sql", function () {
    const dir = mkdtempSync(join(tmpdir(), "migrations-"));
    for (const name of ["20260101_a", "20260102_b", "not_a_migration"]) {
      mkdirSync(join(dir, name));
    }
    writeFileSync(join(dir, "20260101_a", "migration.sql"), "");
    writeFileSync(join(dir, "20260102_b", "migration.sql"), "");
    writeFileSync(join(dir, "migration_lock.toml"), "");
    expect([...localMigrations(dir)].sort()).to.deep.equal(["20260101_a", "20260102_b"]);
  });

  it("accepts only strict template names", function () {
    expect(SAFE_TEMPLATE_NAME.test(TPL)).to.equal(true);
    expect(SAFE_TEMPLATE_NAME.test("preview_pr_12")).to.equal(false);
    expect(SAFE_TEMPLATE_NAME.test("preview_tpl_0123456789ab_x`; DROP DATABASE y")).to.equal(false);
    expect(SAFE_TEMPLATE_NAME.test("EffektDonasjonDB")).to.equal(false);
  });

  describe("CLI", function () {
    const env = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
      PREVIEW_MODE: "true",
      PREVIEW_JWT_SECRET: "x".repeat(64),
      NODE_ENV: "preview",
      DB_NAME: "preview_pr_12",
      DB_USER: "preview",
      DB_PASS: "synthetic-only",
      DB_HOST: "127.0.0.1",
      DB_PORT: "1", // nothing listens: the commands below must fail before connecting
      ...overrides,
    });
    const fails = async (args: string[], e = env()) => {
      try {
        await runDatabaseCli(args, e);
      } catch (err) {
        return (err as Error).message;
      }
      throw new Error(`expected ${args.join(" ")} to fail`);
    };

    it("refuses a seed key that isn't 12 hex characters", async function () {
      expect(await fails(["find-template", "../../etc"])).to.match(/Invalid seed key/);
    });

    it("refuses to clone anything but a template database", async function () {
      expect(await fails(["clone", "EffektDonasjonDB"])).to.match(/Not a template database/);
    });

    it("refuses to mark a PR database as a template", async function () {
      expect(await fails(["mark-template"])).to.match(/Not a template database/);
    });

    it("still runs the startup guard first", async function () {
      expect(await fails(["clone", TPL], env({ DB_NAME: "EffektDonasjonDB" }))).to.match(
        /preview_/,
      );
    });
  });
});
