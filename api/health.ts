import { getHealthPayload } from '../server/api.ts'
import { jsonResponse } from './_utils.ts'

export function GET() {
  return jsonResponse(getHealthPayload())
}
