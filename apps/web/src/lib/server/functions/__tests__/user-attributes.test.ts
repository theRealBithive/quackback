/**
 * Contract group A (contract-c.md), copied verbatim — this file pins A8 for the
 * user-attribute server functions; A1-A7 are pinned in
 * domains/attribute-definitions/__tests__/attribute-definition-rulebook.test.ts.
 *
 * ## A — Attribute definitions (user and company)
 * - A1 User and company attribute definitions follow one rulebook: the same input is
 *   accepted or rejected identically by both, with only the entity name in messages and
 *   the id prefix differing.
 * - A2 A definition's key is stored normalised (trimmed, lowercased, inner whitespace
 *   turned into underscores), its label trimmed, and an empty description or external
 *   key stored as absent.
 * - A3 A key or label that is empty after trimming is rejected; a currency attribute
 *   without a currency code is rejected.
 * - A4 A currency code is kept only while the type is currency: creating a non-currency
 *   attribute drops any code sent, and switching the type away from currency clears the
 *   stored code.
 * - A5 A second definition with an already-used key is refused as a conflict, not
 *   reported as a server error; an update or delete of an unknown id is refused as not
 *   found, naming the entity and the id.
 * - A6 An update that changes nothing writes nothing and returns the current definition.
 * - A7 A database failure while listing, creating, updating or deleting surfaces as a
 *   server error naming the entity in the plural, never as a validation or not-found
 *   error, and it is logged.
 * - A8 The user- and company-attribute server functions check the authorization they
 *   declare before create, update and delete, and hand the payload to the shared service
 *   unchanged.
 *
 * user-attributes.ts rebuilds the create/update payload field-by-field (it does not
 * forward `data` as-is) — see company-attributes.test.ts for the sibling file, which
 * forwards `data` straight through on create and only strips `id` on update. The two
 * shapes read the same for a fully-populated payload, which is what these tests send.
 *
 * createServerFn is stubbed to a directly-callable fn (mirrors
 * assistant-snippets.test.ts) so the real zod validators (createAttributeDefinitionSchema
 * / updateAttributeDefinitionSchema / attributeDefinitionIdSchema) run on every call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  listUserAttributes: vi.fn(),
  createUserAttribute: vi.fn(),
  updateUserAttribute: vi.fn(),
  deleteUserAttribute: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/user-attributes/user-attribute.service', () => ({
  listUserAttributes: hoisted.listUserAttributes,
  createUserAttribute: hoisted.createUserAttribute,
  updateUserAttribute: hoisted.updateUserAttribute,
  deleteUserAttribute: hoisted.deleteUserAttribute,
}))

import {
  listUserAttributesFn,
  createUserAttributeFn,
  updateUserAttributeFn,
  deleteUserAttributeFn,
} from '../user-attributes'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
})

describe('listUserAttributesFn', () => {
  it('(A8) calls the shared service and returns its result unchanged', async () => {
    hoisted.listUserAttributes.mockResolvedValue([{ id: 'user_attr_1' }])
    const result = await listUserAttributesFn()
    expect(hoisted.listUserAttributes).toHaveBeenCalledWith()
    expect(result).toEqual([{ id: 'user_attr_1' }])
  })
})

describe('createUserAttributeFn', () => {
  it('(A8) gates on user_attribute.manage before creating', async () => {
    hoisted.createUserAttribute.mockResolvedValue({ id: 'user_attr_1' })
    await createUserAttributeFn({ data: { key: 'mrr', label: 'MRR', type: 'string' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.USER_ATTRIBUTE_MANAGE,
    })
  })

  it('(A8) hands the payload to the service field-for-field, unchanged', async () => {
    hoisted.createUserAttribute.mockResolvedValue({ id: 'user_attr_1' })
    await createUserAttributeFn({
      data: {
        key: 'mrr',
        label: 'MRR',
        description: 'Monthly recurring revenue',
        type: 'currency',
        currencyCode: 'USD',
        externalKey: 'mrr_external',
      },
    })
    expect(hoisted.createUserAttribute).toHaveBeenCalledWith({
      key: 'mrr',
      label: 'MRR',
      description: 'Monthly recurring revenue',
      type: 'currency',
      currencyCode: 'USD',
      externalKey: 'mrr_external',
    })
  })
})

describe('updateUserAttributeFn', () => {
  it('(A8) gates on user_attribute.manage before updating', async () => {
    hoisted.updateUserAttribute.mockResolvedValue({ id: 'user_attr_1' })
    await updateUserAttributeFn({ data: { id: 'user_attr_1', label: 'New label' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.USER_ATTRIBUTE_MANAGE,
    })
  })

  it('(A8) splits the id off and forwards the rest of the payload field-for-field', async () => {
    hoisted.updateUserAttribute.mockResolvedValue({ id: 'user_attr_1' })
    await updateUserAttributeFn({
      data: {
        id: 'user_attr_1',
        label: 'New label',
        description: 'New description',
        type: 'currency',
        currencyCode: 'EUR',
        externalKey: 'new_external',
      },
    })
    expect(hoisted.updateUserAttribute).toHaveBeenCalledWith('user_attr_1', {
      label: 'New label',
      description: 'New description',
      type: 'currency',
      currencyCode: 'EUR',
      externalKey: 'new_external',
    })
  })
})

describe('deleteUserAttributeFn', () => {
  it('(A8) gates on user_attribute.manage before deleting', async () => {
    hoisted.deleteUserAttribute.mockResolvedValue(undefined)
    await deleteUserAttributeFn({ data: { id: 'user_attr_1' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.USER_ATTRIBUTE_MANAGE,
    })
  })

  it('(A8) deletes by id and reports { deleted: true }', async () => {
    hoisted.deleteUserAttribute.mockResolvedValue(undefined)
    const result = await deleteUserAttributeFn({ data: { id: 'user_attr_1' } })
    expect(hoisted.deleteUserAttribute).toHaveBeenCalledWith('user_attr_1')
    expect(result).toEqual({ deleted: true })
  })
})
