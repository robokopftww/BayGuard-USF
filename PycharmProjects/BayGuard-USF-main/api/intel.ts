import { getIntelPayload } from '../server/api.js'
import { errorResponse, jsonResponse } from './_utils.js'

export async function GET(request: Request) {
  const url = new URL(request.url)

  try {
    const payload = await getIntelPayload({
      refresh: url.searchParams.get('refresh'),
      scenario: url.searchParams.get('scenario'),
    })

    return jsonResponse(payload)
  } catch (error) {
    return errorResponse(error, {
      status: 500,
      body: {
        message: 'Unable to refresh BayGuard intelligence right now.',
      },
    })
  }
}
