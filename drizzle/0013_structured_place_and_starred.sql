-- 0013：结构化地名（省 / 市 / 区）+ 收藏（星标）
--
-- 为什么把地名拆成三级：反查接口（BigDataCloud）本来就分级返回
-- （principalSubdivision / city / locality），此前压成一个「区 市」字符串是**有损**的，
-- 既分不出哪一级是哪一级，也没法按「省」或「市」筛选。
--
-- 注意：**不删** 旧的 location_name。历史行上它是唯一的线索（三级字段全空），
-- 一次性回填做不出（字符串里没有省的信息，猜出来的结构只会是错的）。老条目在
-- 详情页被打开时会自动重新反查（走 BigDataCloud + 本地格子缓存）并升级成结构化三级，
-- 之后该列即为空。检查生产库是否落后请用 scripts/check-schema.mjs（部署前置已接入）。
ALTER TABLE "diary_entries" ADD COLUMN "location_province" text;
ALTER TABLE "diary_entries" ADD COLUMN "location_city" text;
ALTER TABLE "diary_entries" ADD COLUMN "location_district" text;
ALTER TABLE "diary_entries" ADD COLUMN "starred" boolean DEFAULT false NOT NULL;
