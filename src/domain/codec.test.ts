/**
 * base64 编解码测试
 *
 * 这组用例锁死一个**会直接让同步功能挂掉**的陷阱：浏览器的 `btoa` 只接受
 * Latin1 字符，遇到中文会抛 InvalidCharacterError。而这个应用的每一条数据里
 * 都有中文（成员名、家务名），所以裸用 btoa 必然失败。
 */

import { describe, expect, it } from 'vitest'
import { decodeBase64, encodeBase64, newId } from '@/domain/codec'

describe('base64 编解码', () => {
  it('纯 ASCII 往返正确', () => {
    const text = '{"name":"test","points":5}'
    expect(decodeBase64(encodeBase64(text))).toBe(text)
  })

  it('中文往返正确 —— 这是 btoa 直接做不到的', () => {
    const text = '{"name":"小良","chore":"拖地"}'
    expect(decodeBase64(encodeBase64(text))).toBe(text)
  })

  it('emoji 往返正确（代理对，超出基本多文种平面）', () => {
    const text = '🧹拖地🧽 小影 👧'
    expect(decodeBase64(encodeBase64(text))).toBe(text)
  })

  it('证明这个封装是「承重」的：裸 btoa 对中文确实会抛异常', () => {
    // 如果哪天有人把实现改回 btoa(str)，这条断言会提醒他为什么不行
    expect(() => btoa('小良')).toThrow()
    // 而我们的实现在同样的输入上是安全的
    expect(() => encodeBase64('小良')).not.toThrow()
  })

  it('解码时剥离空白 —— GitHub 返回的 base64 是带换行的', () => {
    // 内容要足够长才会跨越 60 字符的换行阈值，否则这条用例是空转的
    const text = JSON.stringify({ records: '拖地扫地洗衣服晾衣服'.repeat(20) })
    const encoded = encodeBase64(text)
    expect(encoded.length).toBeGreaterThan(120)

    // 模拟 GitHub Contents API 的返回格式：每 60 字符插入换行
    const wrapped = encoded.replace(/(.{60})/g, '$1\n')
    expect(wrapped).toContain('\n')
    expect(decodeBase64(wrapped)).toBe(text)
  })

  it('解码时同时容忍换行与空格混排', () => {
    const text = '小良和小影的家务积分榜'.repeat(10)
    const encoded = encodeBase64(text)
    const messy = encoded.replace(/(.{20})/g, '$1 \r\n ')
    expect(decodeBase64(messy)).toBe(text)
  })

  it('长内容往返正确（跨越内部 0x8000 分块边界）', () => {
    // 每块 0x8000 字节，用中文（3 字节/字）构造超过两块的内容
    const text = '拖地扫地洗衣服'.repeat(20_000)
    expect(decodeBase64(encodeBase64(text))).toBe(text)
  })

  it('空字符串往返正确', () => {
    expect(decodeBase64(encodeBase64(''))).toBe('')
  })
})

describe('newId', () => {
  it('生成 uuid v4 格式', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('大量生成不重复', () => {
    const set = new Set<string>()
    for (let i = 0; i < 10_000; i++) set.add(newId())
    expect(set.size).toBe(10_000)
  })
})
