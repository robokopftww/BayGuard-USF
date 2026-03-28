import { getHealthPayload } from '../server/api.js'
import { jsonResponse } from './_utils.js'

export function GET() {
  return jsonResponse(getHealthPayload())
}
