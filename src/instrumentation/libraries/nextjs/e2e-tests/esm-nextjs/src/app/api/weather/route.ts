import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

const EXTERNAL_HTTP_TIMEOUT_MS = Number(process.env.EXTERNAL_HTTP_TIMEOUT_MS || "3000");
const USE_MOCK_EXTERNALS = ["1", "true", "yes"].includes((process.env.USE_MOCK_EXTERNALS || "").toLowerCase());
const MOCK_SERVER_BASE_URL = process.env.MOCK_SERVER_BASE_URL || "http://mock-upstream:8081";

function weatherUrl(location: string): string {
  if (USE_MOCK_EXTERNALS) {
    return `${MOCK_SERVER_BASE_URL}/${encodeURIComponent(location)}?format=j1`;
  }
  return `http://wttr.in/${encodeURIComponent(location)}?format=j1`;
}

function buildWeatherPayload(location: string, data: any, fallback = false) {
  const currentCondition = data?.current_condition?.[0] || {};
  return {
    location,
    current: {
      temp_F: currentCondition.temp_F ?? "72",
      humidity: currentCondition.humidity ?? "55",
      localObsDateTime: currentCondition.localObsDateTime ?? "unknown",
      weatherDesc: currentCondition.weatherDesc?.[0]?.value ?? "Clear",
      pressure: currentCondition.pressure ?? "1015",
    },
    source: USE_MOCK_EXTERNALS ? "mock-upstream" : "wttr.in",
    ...(fallback ? { fallback: true } : {}),
  };
}

export async function GET(request: NextRequest) {
  try {
    // Get location from query params
    const searchParams = request.nextUrl.searchParams;
    const location = searchParams.get("location");

    // Default to a generic location if none provided
    const weatherLocation = location || "San Francisco";

    const response = await axios.get(weatherUrl(weatherLocation), { timeout: EXTERNAL_HTTP_TIMEOUT_MS });

    console.log("Weather API call successful", {
      location: weatherLocation,
    });

    return NextResponse.json(buildWeatherPayload(weatherLocation, response.data));
  } catch (error) {
    console.error("Error getting weather data", { error, location: request.nextUrl.searchParams.get("location") });

    const fallbackLocation = request.nextUrl.searchParams.get("location") || "San Francisco";
    return NextResponse.json(
      {
        ...buildWeatherPayload(fallbackLocation, {}, true),
        error: "Failed to fetch weather data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get location from request body
    const body = await request.json();
    const location = body.location;

    // Validate that location is provided
    if (!location) {
      return NextResponse.json(
        { error: "Location is required in request body" },
        { status: 400 }
      );
    }

    const response = await axios.get(weatherUrl(location), { timeout: EXTERNAL_HTTP_TIMEOUT_MS });

    console.log("Weather API call successful (POST)", {
      location: location,
    });

    return NextResponse.json(buildWeatherPayload(location, response.data));
  } catch (error) {
    console.error("Error getting weather data (POST)", { error });

    const fallbackLocation = (await request.clone().json().catch(() => ({}))).location || "San Francisco";
    return NextResponse.json(
      {
        ...buildWeatherPayload(fallbackLocation, {}, true),
        error: "Failed to fetch weather data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
