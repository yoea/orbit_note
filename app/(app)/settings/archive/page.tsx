'use client'

import ArchiveListView from '@/components/ArchiveListView'

// 解锁守卫统一在 (app)/layout.tsx 处理。
//
// 路由登记（记忆里的铁律）：新增路由要同时进 proxy.ts 的 matcher 与 proxy-guard.ts 的
// protectedPaths。本页**两处都不用改**——`/settings/:path*` 与 `/settings` 前缀匹配都已覆盖它。
// tests/proxy-matcher-coverage.test.ts 会核对 matcher 覆盖面。
export default function ArchivePage() {
  return <ArchiveListView />
}
