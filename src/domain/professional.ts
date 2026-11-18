import { unzipSync, zipSync, strToU8 } from "fflate";
import { inflateSync } from "node:zlib";
import { requireValue as need, data } from "../../vendor/project-store.ts";
import { fileBytes, decode64, hash, artifact } from "./artifact.ts";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function pngChunk(type: string, data: Uint8Array) {
  const t = Buffer.from(type),
    d = Buffer.from(data),
    out = Buffer.alloc(d.length + 12);
  out.writeUInt32BE(d.length);
  t.copy(out, 4);
  d.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, d])), out.length - 4);
  return out;
}
export function pngChunks(bytes: Buffer) {
  need(bytes.subarray(0, 8).equals(pngSignature), "不是PNG文件。");
  let offset = 8,
    ended = false;
  const out: any[] = [];
  while (offset < bytes.length) {
    need(offset + 12 <= bytes.length, "PNG块头不完整。");
    const size = bytes.readUInt32BE(offset),
      end = offset + 12 + size;
    need(size <= 8 * 1024 * 1024 && end <= bytes.length, "PNG块长度越界。");
    const type = bytes.toString("ascii", offset + 4, offset + 8),
      data = bytes.subarray(offset + 8, end - 4);
    need(
      crc32(bytes.subarray(offset + 4, end - 4)) ===
        bytes.readUInt32BE(end - 4),
      "PNG块CRC不一致。",
    );
    out.push({ type, data, bytes: bytes.subarray(offset, end) });
    offset = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  need(
    ended &&
      offset === bytes.length &&
      out[0]?.type === "IHDR" &&
      out[0].data.length === 13 &&
      out.some((x) => x.type === "IDAT"),
    "PNG结构不完整或包含尾随数据。",
  );
  return out;
}
function metadata(c: any): { key: string; text: string } | undefined {
  if (!["tEXt", "zTXt", "iTXt"].includes(c.type)) return;
  const zero = c.data.indexOf(0);
  need(zero > 0 && zero <= 79, "PNG文本关键字无效。");
  const key = c.data.toString("latin1", 0, zero);
  let b = c.data.subarray(zero + 1);
  if (c.type === "zTXt") {
    need(b[0] === 0, "PNG压缩方式不支持。");
    b = inflateSync(b.subarray(1), { maxOutputLength: 240000 });
  }
  if (c.type === "iTXt") {
    need(
      b.length >= 4 && [0, 1].includes(b[0]) && b[1] === 0,
      "PNG国际文本头无效。",
    );
    const compressed = b[0];
    b = b.subarray(2);
    for (let k = 0; k < 2; k++) {
      const n = b.indexOf(0);
      need(n >= 0, "PNG国际文本头不完整。");
      b = b.subarray(n + 1);
    }
    if (compressed) b = inflateSync(b, { maxOutputLength: 240000 });
  }
  return { key, text: b.toString("utf8") };
}
export function safeZip(bytes: Buffer) {
  let total = 0;
  const seen = new Set<string>();
  const entries = unzipSync(bytes, {
    filter: (f) => {
      need(!seen.has(f.name), "CHARX包含重复路径。");
      seen.add(f.name);
      need(
        !f.name.startsWith("/") &&
          !f.name.includes("\\") &&
          !f.name.split("/").some((x) => x === ".." || x === ".") &&
          !/^[A-Za-z]:/.test(f.name) &&
          !f.name.includes("\0"),
        "CHARX路径无效。",
      );
      total += f.originalSize;
      need(
        f.originalSize <= 2 * 1024 * 1024 &&
          total <= 4 * 1024 * 1024 &&
          seen.size <= 100,
        "CHARX解压超出预算。",
        "hetu.budget_exceeded",
      );
      return true;
    },
  });
  need(Object.keys(entries).length > 0, "CHARX为空。");
  return entries;
}
function jsonText(bytes: Uint8Array) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  need(
    Buffer.byteLength(text) <= 240000,
    "角色结构超过240KB，请分拆世界书。",
    "hetu.budget_exceeded",
  );
  return text;
}
export function card(raw: string) {
  const p = JSON.parse(raw);
  need(p && typeof p === "object" && !Array.isArray(p), "角色卡根对象无效。");
  const spec = p.spec ?? (p.entries ? "worldbook" : "legacy");
  need(
    ["chara_card_v2", "chara_card_v3", "worldbook", "legacy"].includes(spec),
    "未知角色卡规范。",
  );
  const data = p.spec ? p.data : p;
  need(
    data && typeof data === "object" && !Array.isArray(data),
    "角色卡data无效。",
  );
  const world =
      spec === "worldbook"
        ? p
        : (data.character_book ?? data.extensions?.world),
    originalEntries = world?.entries ?? [];
  need(
    Array.isArray(originalEntries) ||
      (originalEntries && typeof originalEntries === "object"),
    "世界书entries无效。",
  );
  const entries = Object.entries(originalEntries).map(
    ([key, e]: [string, any]) => {
      need(
        e && typeof e === "object" && typeof e.content === "string",
        "世界书条目缺少文本。",
      );
      const keys = e.keys ?? e.key ?? [];
      need(
        Array.isArray(keys) && keys.every((x) => typeof x === "string"),
        "世界书关键词无效。",
      );
      return {
        id: String(e.id ?? e.uid ?? key),
        title: e.name ?? e.comment ?? keys.join("、") ?? key,
        content: e.content,
        keys,
        enabled: e.enabled ?? !e.disable,
        constant: e.constant ?? false,
      };
    },
  );
  need(
    new Set(entries.map((x) => x.id)).size === entries.length,
    "世界书条目身份重复。",
  );
  if (spec !== "worldbook")
    need(typeof data.name === "string" && data.name.trim(), "角色卡缺少姓名。");
  return {
    spec,
    data,
    entries,
    fields: Object.keys(data),
    character:
      spec === "worldbook"
        ? null
        : {
            name: data.name,
            description: data.description ?? "",
            personality: data.personality ?? "",
            scenario: data.scenario ?? "",
          },
    warnings: [
      ...(data.system_prompt || data.post_history_instructions
        ? ["卡内指令只作为原始资料保存，不作为系统指令执行。"]
        : []),
      ...(data.extensions?.regex_scripts || data.extensions?.regex
        ? ["正则与脚本扩展已保留，但不执行。"]
        : []),
      ...(entries.some((e) => !e.enabled) ? ["禁用世界书条目保持禁用。"] : []),
    ],
  };
}
export function parseFile(file: any, limit = 1024 * 1024) {
  const b = fileBytes(file, limit);
  let format: string, raw: string;
  if (b.subarray(0, 8).equals(pngSignature)) {
    format = "png";
    const candidates = pngChunks(b)
      .map(metadata)
      .filter((x) => x && ["chara", "ccv3"].includes(x.key)) as {
      key: string;
      text: string;
    }[];
    need(candidates.length > 0, "PNG不包含角色卡元数据。");
    need(
      new Set(candidates.map((x) => x.key)).size === candidates.length,
      "PNG包含重复角色卡关键字。",
    );
    const m = candidates.find((x) => x.key === "ccv3") ?? candidates[0];
    raw = m.text.trim().startsWith("{")
      ? m.text
      : jsonText(decode64(m.text, 240000));
  } else if (b[0] === 0x50 && b[1] === 0x4b) {
    format = "charx";
    const entries = safeZip(b);
    need(entries["card.json"], "CHARX缺少card.json。");
    raw = jsonText(entries["card.json"]);
  } else {
    format = "json";
    raw = jsonText(b);
  }
  const parsed = card(raw);
  return {
    exchange: {
      id: "exchange_" + file.sha256.slice(0, 20),
      title: parsed.character?.name ?? parsed.data.name ?? file.filename,
      filename: file.filename,
      file_sha256: file.sha256,
      format,
      spec: parsed.spec,
      raw_json: raw,
      asset_source_index: null,
    },
    ...parsed,
    losses: [],
    preserved_fields: parsed.fields,
  };
}
export function validateDomain(p: any) {
  for (const e of p.exchanges) {
    need(
      card(e.raw_json).spec === e.spec,
      "交换记录的规范版本与原始结构不一致。",
    );
  }
  for (const m of p.mappings) {
    const e = p.exchanges.find((x: any) => x.id === m.exchange_id);
    need(e, "映射引用的交换记录不存在。");
    let value: any = JSON.parse(e.raw_json);
    for (const k of m.field_path.split(".")) {
      need(value && Object.hasOwn(value, k), "映射字段路径不存在。");
      value = value[k];
    }
  }
}
export async function checkSources(p: any, sources: any[], _request?: any) {
  for (const e of p.exchanges)
    if (e.asset_source_index !== null) {
      const asset = sources[e.asset_source_index]?.resource?.asset;
      need(
        asset?.blob?.sha256 === e.file_sha256,
        "交换原件与固定素材摘要不一致。",
      );
    }
}
export function pureAction(action: string, i: any) {
  if (action === "parse_file") return parseFile(i.file);
}
async function assetFile(source: any, request: any) {
  need(
    source?.source_ref?.kind === "asset" &&
      source.resource?.asset?.blob?.media_type === "image/png",
    "素材角色卡入口只接受固定PNG资产；JSON与CHARX使用直接文件入口。",
  );
  const parts: Buffer[] = [];
  let offset = 0,
    expected = "",
    total = 0;
  do {
    const r = data(
      await request("hetu.extensions.sources.read_blob", {
        source_ref: source.source_ref,
        offset,
        max_bytes: 131072,
      }),
    );
    need(
      r.total_bytes <= 8 * 1024 * 1024,
      "PNG角色卡超过8MiB。",
      "hetu.budget_exceeded",
    );
    if (expected)
      need(
        expected === r.sha256 && total === r.total_bytes,
        "PNG分块版本不一致。",
      );
    expected = r.sha256;
    total = r.total_bytes;
    const b = decode64(r.base64, 131072);
    need(hash(b) === r.chunk_sha256, "PNG分块摘要不一致。");
    parts.push(b);
    if (r.next_offset === null) break;
    need(
      r.next_offset === offset + b.length && r.next_offset > offset,
      "PNG分块偏移无效。",
    );
    offset = r.next_offset;
  } while (parts.length < 65);
  const b = Buffer.concat(parts);
  need(b.length === total && hash(b) === expected, "PNG原件完整摘要不一致。");
  return {
    filename: source.resource.asset.original_filename ?? "角色卡.png",
    base64: b.toString("base64"),
    sha256: expected,
  };
}
export async function readProfessional(
  action: string,
  p: any,
  sources: any[],
  i: any,
  request?: any,
): Promise<any> {
  if (action === "parse_asset") {
    const file = await assetFile(sources[i.source_index], request),
      result = parseFile(file, 8 * 1024 * 1024);
    return {
      ...result,
      exchange: { ...result.exchange, asset_source_index: i.source_index },
    };
  }
  const e = p.exchanges.find((v: any) => v.id === i.exchange_id);
  if (
    [
      "inspect_exchange",
      "export_exchange",
      "export_asset_exchange",
      "preview_mapping",
    ].includes(action)
  )
    need(e, "交换记录不存在。");
  if (action === "export_asset_exchange") {
    need(e.asset_source_index !== null, "该交换记录未绑定固定PNG原件。");
    return readProfessional(
      "export_exchange",
      p,
      sources,
      {
        ...i,
        original_file: await assetFile(sources[e.asset_source_index], request),
      },
      request,
    );
  }
  if (action === "inspect_exchange")
    return { exchange_id: e.id, ...card(e.raw_json) };
  if (action === "preview_mapping")
    return {
      exchange_id: e.id,
      mappings: p.mappings.filter((m: any) => m.exchange_id === e.id),
      unmapped_fields: card(e.raw_json).fields.filter(
        (f) =>
          !p.mappings.some(
            (m: any) =>
              m.exchange_id === e.id &&
              m.field_path === (e.spec.startsWith("chara") ? "data." : "") + f,
          ),
      ),
      losses: [],
      note: "这是宿主设定候选的字段备料；未映射不等于删除，正式设定另行决定。",
    };
  if (action === "export_exchange") {
    need(
      i.original_file.sha256 === e.file_sha256,
      "导出必须使用原交换文件。",
      "hetu.stale_evidence",
    );
    const original = fileBytes(i.original_file, 8 * 1024 * 1024),
      parsed = parseFile(i.original_file, 8 * 1024 * 1024);
    need(parsed.exchange.format === e.format, "原文件格式不一致。");
    let out: Uint8Array;
    if (e.format === "json") out = Buffer.from(e.raw_json);
    else if (e.format === "png") {
      const texts = pngChunks(original).map(metadata).filter(Boolean);
      const key = texts.some((m:any)=>m.key==='ccv3') ? 'ccv3' : 'chara';
      const chunks = pngChunks(original).filter(
        (c) => metadata(c)?.key !== key,
      );
      const newChunk = pngChunk(
          "tEXt",
          Buffer.from(key + "\0" + Buffer.from(e.raw_json).toString("base64")),
        );
      out = Buffer.concat([
        pngSignature,
        ...chunks.flatMap((c) =>
          c.type === "IEND" ? [newChunk, c.bytes] : [c.bytes],
        ),
      ]);
    } else {
      const entries = safeZip(original);
      entries["card.json"] = strToU8(e.raw_json);
      out = zipSync(entries, {
        level: 6,
        mtime: new Date("2000-01-01T00:00:00Z"),
      });
    }
    const losses:any[]=[];
    function removed(before:any,after:any,path=''){
      if(!before||typeof before!=='object')return;
      for(const key of Object.keys(before)){
        const at=path+'/'+key.replaceAll('~','~0').replaceAll('/','~1');
        if(!after||typeof after!=='object'||!Object.hasOwn(after,key))losses.push({kind:'field_removed',path:at,message:'当前结构已移除此原始字段；请核对是否为有意修改。'});
        else removed(before[key],after[key],at);
      }
    }
    removed(JSON.parse(parsed.exchange.raw_json),JSON.parse(e.raw_json));
    const raw_json_changed=e.raw_json!==parsed.exchange.raw_json;
    return {
      ...artifact(
        out,
        e.filename,
        e.format === "png"
          ? "image/png"
          : e.format === "charx"
            ? "application/zip"
            : "application/json",
        i,
      ),
      losses,
      original_sha256: e.file_sha256,
      raw_json_changed,
      preserved_unknown_fields: losses.length ? false : raw_json_changed ? null : true,
    };
  }
}
