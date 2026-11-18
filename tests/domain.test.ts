import assert from "node:assert/strict";
import { test } from "node:test";
import {
  scenario,
  original,
  range,
  cardFile,
  cardJSON,
  wav,
  sha,
} from "./support/scenario.ts";
import {
  card,
  parseFile,
  readProfessional,
  pngChunk,
  crc32,
  safeZip,
  validateDomain,
} from "../src/domain/professional.ts";
import { zipSync, unzipSync, strToU8 } from "fflate";
test("V2、V3与世界书保留未知扩展和禁用条目", () => {
  const r = parseFile(cardFile);
  assert.equal(r.entries[0].enabled, false);
  assert.equal(r.data.extensions.custom.kept, true);
  assert.ok(r.warnings.length);
  const v2 = JSON.parse(cardJSON);
  v2.spec = "chara_card_v2";
  assert.equal(card(JSON.stringify(v2)).spec, "chara_card_v2");
  assert.equal(
    card(
      JSON.stringify({
        entries: { 2: { key: ["信"], content: "来信", disable: true } },
      }),
    ).entries[0].enabled,
    false,
  );
});
test("错误摘要、畸形Base64和无姓名角色卡拒绝", () => {
  assert.throws(() => parseFile({ ...cardFile, sha256: "a".repeat(64) }));
  assert.throws(() => parseFile({ ...cardFile, base64: "%%%=" }));
  assert.throws(() => card('{"spec":"chara_card_v3","data":{}}'));
});
test("JSON往返未知字段和脚本扩展逐字保留", async () => {
  const p = scenario(),
    r: any = await readProfessional("export_exchange", p, [], {
      exchange_id: "lin",
      original_file: cardFile,
    });
  assert.equal(Buffer.from(r.base64, "base64").toString(), cardJSON);
  assert.deepEqual(
    JSON.parse(Buffer.from(r.base64, "base64").toString()).data.extensions,
    JSON.parse(cardJSON).data.extensions,
  );
});
test("PNG嵌入卡片CRC核验与往返像素块保持", async () => {
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
    "base64",
  );
  const { pngChunks } = requireModule;
  const chunks = pngChunks(image);
  const b = Buffer.concat([
    image.subarray(0, 8),
    ...chunks.flatMap((c: any) =>
      c.type === "IEND"
        ? [
            pngChunk(
              "tEXt",
              Buffer.from("ccv3\0" + Buffer.from(cardJSON).toString("base64")),
            ),
            c.bytes,
          ]
        : [c.bytes],
    ),
  ]);
  const file = {
      filename: "lin.png",
      base64: b.toString("base64"),
      sha256: sha(b),
    },
    parsed = parseFile(file),
    p = { ...scenario(), exchanges: [parsed.exchange] },
    out: any = await readProfessional("export_exchange", p, [], {
      exchange_id: parsed.exchange.id,
      original_file: file,
    });
  assert.equal(
    parseFile({ ...file, base64: out.base64, sha256: out.sha256 }).character
      ?.name,
    "林溪",
  );
  const bad = Buffer.from(b);
  bad[20] ^= 1;
  assert.throws(() =>
    parseFile({ ...file, base64: bad.toString("base64"), sha256: sha(bad) }),
  );
});
test("CHARX保留附件并拒绝穿越和过大解压", async () => {
  const bytes = zipSync({
    "card.json": strToU8(cardJSON),
    "assets/readme.txt": strToU8("保留附件"),
  });
  const file = {
      filename: "lin.charx",
      base64: Buffer.from(bytes).toString("base64"),
      sha256: sha(bytes),
    },
    parsed = parseFile(file),
    r: any = await readProfessional(
      "export_exchange",
      { ...scenario(), exchanges: [parsed.exchange] },
      [],
      { exchange_id: parsed.exchange.id, original_file: file },
    );
  assert.equal(
    Buffer.from(
      unzipSync(Buffer.from(r.base64, "base64"))["assets/readme.txt"],
    ).toString(),
    "保留附件",
  );
  assert.throws(() =>
    safeZip(Buffer.from(zipSync({ "../bad": strToU8("x") }))),
  );
  assert.throws(() =>
    safeZip(
      Buffer.from(zipSync({ large: new Uint8Array(2 * 1024 * 1024 + 1) })),
    ),
  );
});
test("字段映射不存在或交换记录被删除时拒绝", () => {
  const p = scenario();
  p.mappings = [
    {
      id: "m",
      exchange_id: "lin",
      field_path: "data.missing",
      target_kind: "note",
      target_entity_ref: null,
      note: "",
    },
  ];
  assert.throws(() => validateDomain(p));
  p.mappings[0].field_path = "data.name";
  validateDomain(p);
  p.exchanges = [];
  assert.throws(() => validateDomain(p));
});
import * as requireModule from "../src/domain/professional.ts";
