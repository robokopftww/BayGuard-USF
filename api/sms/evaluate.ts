import { evaluateSmsPayload } from '../../server/api.ts'
import { errorResponse, jsonResponse } from '../_utils.ts'

export async function POST() {
  try {
    return jsonResponse(await evaluateSmsPayload())
  } catch (error) {
    return errorResponse(error, {
      status: 500,
      body: {
        message: 'Unable to evaluate BayGuard SMS alerts right now.',
      },
    })
  }
}
