import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMAND_ROUTE_SPECS } from "../src/commands/commandRegistry.js";

test("command routing marks only read-only viewer commands as non-mutating", () => {
    const mutating: string[] = COMMAND_ROUTE_SPECS.filter((route) => route.mutates).map((route) => route.name);
    const readOnly: string[] = COMMAND_ROUTE_SPECS.filter((route) => !route.mutates).map((route) => route.name);

    assert.deepEqual(readOnly, ["view-status", "view-participants"]);
    assert.ok(mutating.includes("start-next-round"));
    assert.ok(mutating.includes("start-next-random-round"));
    assert.ok(mutating.includes("reset"));
    assert.ok(!readOnly.includes("start-next-round"));
});

test("command routing assigns the expected access levels", () => {
    const byName = Object.fromEntries(COMMAND_ROUTE_SPECS.map((route) => [route.name, route.access]));
    assert.equal(byName["set-admin-role"], "server-admin");
    assert.equal(byName.create, "auction-admin");
    assert.equal(byName["view-status"], "public");
    assert.equal(byName["view-participants"], "public");
});

test("command routing has unique subcommand names", () => {
    const names = COMMAND_ROUTE_SPECS.map((route) => route.name);
    assert.equal(new Set(names).size, names.length);
    assert.equal(names.length, 16);
});
