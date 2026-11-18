import { names } from "../domain/report.ts";
const label = (v: string) => names[v] ?? v;
export function rowTitle(field: string, v: any, p: any): string {
  return v.title ?? v.name ?? v.source ?? v.label ?? v.marker ?? "记录";
}
export function rowContent(field: string, v: any, p: any): any {
  if (field === "exchanges")
    return {
      原文件: v.filename,
      文件格式: v.format.toUpperCase(),
      规范: v.spec,
      原件来源: v.asset_source_index === null ? "固定文件摘要" : "宿主固定素材",
    };
  if (field === "mappings")
    return {
      原字段: v.field_path,
      接续类型: label(v.target_kind),
      说明: v.note,
    };
  const { id, title, name, ...rest } = v;
  return rest;
}
export function panelContent(action: string, v: any, p: any): any {
  if (action === "inspect_exchange")
    return {
      角色: v.character,
      世界书条目: v.entries.map((e: any) => ({
        条目: e.title,
        内容: e.content,
        关键词: e.keys,
        启用: e.enabled,
        常驻: e.constant,
      })),
      需要留意: v.warnings,
    };
  if (action === "preview_mapping")
    return {
      字段映射: v.mappings.map((m: any) => ({
        原字段: m.field_path,
        接续类型: label(m.target_kind),
        说明: m.note,
      })),
      尚未映射: v.unmapped_fields,
      转换说明: v.losses,
      说明: v.note,
    };
  return v;
}
