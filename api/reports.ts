import {
  createCommunityReportPayload,
  deleteCommunityReportPayload,
  getCommunityReportsPayload,
} from '../server/api.js'
import { errorResponse, jsonResponse, readJsonBody } from './_utils.js'

export async function GET() {
  try {
    return jsonResponse(await getCommunityReportsPayload())
  } catch (error) {
    return errorResponse(error, {
      status: 500,
      body: {
        message: 'Unable to load BayGuard community reports right now.',
      },
    })
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request)
    return jsonResponse(await createCommunityReportPayload(body), { status: 201 })
  } catch (error) {
    return errorResponse(error, {
      status: 400,
      body: {
        message: 'Unable to save this community report.',
      },
    })
  }
}

export async function DELETE(request: Request) {
  try {
    const reportId = new URL(request.url).searchParams.get('id')
    return jsonResponse(await deleteCommunityReportPayload({ id: reportId }))
  } catch (error) {
    return errorResponse(error, {
      status: 404,
      body: {
        message: 'Unable to remove this community report.',
      },
    })
  }
}
