-- 头像（2026-11-04）
--
-- 两列都是可空的：null = 用户没设置自定义头像，界面回退成「名字首字母 + 品牌渐变」。
--
-- avatar_key：OSS 对象 key（形如 orbit/avatar/current.webp）。存 key 不存 URL ——
--   换域名 / 换 endpoint 时不用动数据，展示用的 URL 由服务端每次签 24 小时有效的签名地址。
-- avatar_updated_at：拼进 URL 的版本号（?v=<毫秒>）。头像是固定 key 覆盖写，
--   不带版本号会让浏览器继续用旧图的缓存。
--
-- 用 IF NOT EXISTS：这条迁移可能在「列已经手工加过」的库上重跑，别让它炸。
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS avatar_key text;
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;
