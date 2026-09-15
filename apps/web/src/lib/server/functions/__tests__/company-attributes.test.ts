/**
 * Contract group A (contract-c.md), copied verbatim — this file pins A8 for the
 * company-attribute server functions; A1-A7 are pinned in
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
 * company-attributes.ts forwards `data` straight through on create, and only strips
 * `id` off via destructuring on update — a different shape from user-attributes.ts's
 * field-by-field rebuild (see that file's suite). The two read the same for a
 * fully-populated payload, which is what these tests send.
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
  listCompanyAttributes: vi.fn(),
  createCompanyAttribute: vi.fn(),
  updateCompanyAttribute: vi.fn(),
  deleteCompanyAttribute: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/company-attributes', () => ({
  listCompanyAttributes: hoisted.listCompanyAttributes,
  createCompanyAttribute: hoisted.createCompanyAttribute,
  updateCompanyAttribute: hoisted.updateCompanyAttribute,
  deleteCompanyAttribute: hoisted.deleteCompanyAttribute,
}))

import {
  listCompanyAttributesFn,
  createCompanyAttributeFn,
  updateCompanyAttributeFn,
  deleteCompanyAttributeFn,
} from '../company-attributes'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
})

describe('listCompanyAttributesFn', () => {
  it('(A8) calls the shared service and returns its result unchanged', async () => {
    hoisted.listCompanyAttributes.mockResolvedValue([{ id: 'company_attr_1' }])
    const result = await listCompanyAttributesFn()
    expect(hoisted.listCompanyAttributes).toHaveBeenCalledWith()
    expect(result).toEqual([{ id: 'company_attr_1' }])
  })
})

describe('createCompanyAttributeFn', () => {
  it('(A8) gates on company.manage before creating', async () => {
    hoisted.createCompanyAttribute.mockResolvedValue({ id: 'company_attr_1' })
    await createCompanyAttributeFn({
      data: { key: 'plan_tier', label: 'Plan tier', type: 'string' },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.COMPANY_MANAGE })
  })

  it('(A8) hands the payload straight through to the service, unchanged', async () => {
    hoisted.createCompanyAttribute.mockResolvedValue({ id: 'company_attr_1' })
    const payload = {
      key: 'plan_tier',
      label: 'Plan tier',
      description: 'Subscription plan tier',
      type: 'currency' as const,
      currencyCode: 'USD' as const,
      externalKey: 'plan_tier_external',
    }
    await createCompanyAttributeFn({ data: payload })
    expect(hoisted.createCompanyAttribute).toHaveBeenCalledWith(payload)
  })
})

describe('updateCompanyAttributeFn', () => {
  it('(A8) gates on company.manage before updating', async () => {
    hoisted.updateCompanyAttribute.mockResolvedValue({ id: 'company_attr_1' })
    await updateCompanyAttributeFn({ data: { id: 'company_attr_1', label: 'New label' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.COMPANY_MANAGE })
  })

  it('(A8) splits the id off and forwards the rest of the payload unchanged', async () => {
    hoisted.updateCompanyAttribute.mockResolvedValue({ id: 'company_attr_1' })
    await updateCompanyAttributeFn({
      data: {
        id: 'company_attr_1',
        label: 'New label',
        description: 'New description',
        type: 'currency',
        currencyCode: 'EUR',
        externalKey: 'new_external',
      },
    })
    expect(hoisted.updateCompanyAttribute).toHaveBeenCalledWith('company_attr_1', {
      label: 'New label',
      description: 'New description',
      type: 'currency',
      currencyCode: 'EUR',
      externalKey: 'new_external',
    })
  })
})

describe('deleteCompanyAttributeFn', () => {
  it('(A8) gates on company.manage before deleting', async () => {
    hoisted.deleteCompanyAttribute.mockResolvedValue(undefined)
    await deleteCompanyAttributeFn({ data: { id: 'company_attr_1' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.COMPANY_MANAGE })
  })

  it('(A8) deletes by id and reports { deleted: true }', async () => {
    hoisted.deleteCompanyAttribute.mockResolvedValue(undefined)
    const result = await deleteCompanyAttributeFn({ data: { id: 'company_attr_1' } })
    expect(hoisted.deleteCompanyAttribute).toHaveBeenCalledWith('company_attr_1')
    expect(result).toEqual({ deleted: true })
  })
})
