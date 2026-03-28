import { getHealthPayload } from '../server/api'
import { jsonResponse } from './_utils'

export function GET() {
  return jsonResponse(getHealthPayload())
}
