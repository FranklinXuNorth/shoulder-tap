import assert from "node:assert/strict";
import { keyOf, seal, unseal, relaySend } from "./relay.mjs";

// 派生是确定的，两台机器同一个 token 就同一把钥匙。
const key = keyOf("ntn_test_token");
assert.equal(key.length, 32);
assert.deepEqual(key, keyOf("ntn_test_token"));
assert.notDeepEqual(key, keyOf("ntn_other"));

// 封了能解开，改一个字节就解不开。
const blob = seal(key, { host: "MAC", gesture: "snap", caption: "问题？", text: "问题？" });
assert.deepEqual(unseal(key, blob), { host: "MAC", gesture: "snap", caption: "问题？", text: "问题？" });
const raw = Buffer.from(blob, "base64");
raw[20] ^= 1;
assert.throws(() => unseal(key, raw.toString("base64")));

// 没配就直接 false，不发请求。
assert.equal(await relaySend({}, "dev", "tap", { caption: "x" }), false);
assert.equal(await relaySend({ SHOULDER_TAP_RELAY: "http://127.0.0.1:1", NOTION_TOKEN: "t" }, "dev", "tap", {}), false);

// 桌面端 Relay.cs 的测试用同一组常量核对，改这里就得改那边。
console.log("key hex for ntn_test_token:", key.toString("hex"));
console.log("relay.test ok");
