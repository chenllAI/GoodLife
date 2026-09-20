/**
 * 邀请链接测试
 *
 * 这组用例守的是一个安全属性：**令牌必须放在 URL 的 fragment 里，不能放查询参数。**
 *
 * 查询参数会随请求发给服务器，会进 GitHub Pages 的访问日志；fragment 不会离开
 * 浏览器。放错位置等于把仓库的写权限写进别人的服务器日志。
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { buildInviteLink, consumeInviteToken } from '@/config/invite'

const TOKEN = 'github_pat_11ABCDEFG_test_token_value'

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('buildInviteLink', () => {
  it('令牌放在 fragment 里，而不是查询参数里', () => {
    const link = buildInviteLink(TOKEN, 'https://example.com/app/')
    expect(link).toContain('#t=')
    expect(link).not.toContain('?t=')
    // fragment 之前不能出现令牌
    const beforeHash = link.split('#')[0] ?? ''
    expect(beforeHash).not.toContain('github_pat')
  })

  it('对令牌做了 URL 编码', () => {
    const link = buildInviteLink('a b&c=d', 'https://example.com/')
    expect(link).not.toContain(' ')
    expect(link).toContain(encodeURIComponent('a b&c=d'))
  })
})

describe('consumeInviteToken', () => {
  it('能从地址里取出令牌', () => {
    window.history.replaceState(null, '', `/#t=${encodeURIComponent(TOKEN)}`)
    expect(consumeInviteToken()).toBe(TOKEN)
  })

  it('取出后立即把 fragment 从地址栏清掉（不留凭据在可见处）', () => {
    window.history.replaceState(null, '', `/#t=${encodeURIComponent(TOKEN)}`)
    consumeInviteToken()
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain('github_pat')
  })

  it('地址里没有令牌时返回 null，且不报错', () => {
    window.history.replaceState(null, '', '/')
    expect(consumeInviteToken()).toBeNull()
  })

  it('无关的 fragment 不会被误当成令牌', () => {
    window.history.replaceState(null, '', '/#section-2')
    expect(consumeInviteToken()).toBeNull()
  })

  it('空值不会被当成有效令牌', () => {
    window.history.replaceState(null, '', '/#t=')
    expect(consumeInviteToken()).toBeNull()
  })

  it('生成再解析，往返一致', () => {
    const link = buildInviteLink(TOKEN, 'https://example.com/app/')
    const hash = new URL(link).hash
    window.history.replaceState(null, '', `/${hash}`)
    expect(consumeInviteToken()).toBe(TOKEN)
  })

  it('中文与特殊字符的令牌也能正确往返', () => {
    const weird = 'tok+en/with=chars&more'
    const link = buildInviteLink(weird, 'https://example.com/')
    window.history.replaceState(null, '', `/${new URL(link).hash}`)
    expect(consumeInviteToken()).toBe(weird)
  })
})
