# 操作地图

由正式清单生成，执行前发现当前安装版Schema。

| 动作 | 用途 | 必填参数 | 效果 |
| --- | --- | --- | --- |
| list_projects | 查找专业工程 |  | read |
| get_project | 读取固定专业工程 | object_id | read |
| save_project | 保存完整专业工程 | expected_revision, expected_sha256, operation_key, content | managed_write |
| put_exchange | 维护交换记录 | object_id, expected_revision, expected_sha256, operation_key, exchange | managed_write |
| remove_exchange | 移除交换记录 | object_id, expected_revision, expected_sha256, operation_key, exchange_id | managed_write |
| put_mapping | 维护字段映射 | object_id, expected_revision, expected_sha256, operation_key, mapping | managed_write |
| remove_mapping | 移除字段映射 | object_id, expected_revision, expected_sha256, operation_key, mapping_id | managed_write |
| parse_file | 解析固定角色卡或世界书 | file | read |
| inspect_exchange | 审阅角色与世界书字段 | object_id, exchange_id | read |
| export_exchange | 往返导出角色卡与世界书 | object_id, exchange_id, original_file | read |
| preview_mapping | 预览宿主字段接续与损失 | object_id, exchange_id | read |
| get_source | 读取固定来源 | object_id, source_index | read |
| get_basis | 读取固定上游专业依据 | object_id, basis_index | read |
| compare_versions | 比较专业修订 | object_id, from_revision, to_revision | read |
| export_project | 导出固定专业报告 | object_id, format | read |
| build_context | 准备有界专业上下文 | object_id, goal, max_chars | read |
| create_handoff | 生成固定专业交接 | object_id, goal | read |
| get_operation | 沿原键回读操作 | operation_key | read |
| parse_asset | 解析当前作品的固定PNG角色卡 | object_id, source_index | read |
| export_asset_exchange | 从固定PNG原件往返导出 | object_id, exchange_id | read |
