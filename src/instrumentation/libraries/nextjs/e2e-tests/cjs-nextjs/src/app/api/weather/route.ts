import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

export async function GET(request: NextRequest) {
  try {
    // Get location from query params
    const searchParams = request.nextUrl.searchParams;
    const location = searchParams.get("location");

    // Default to a generic location if none provided
    const weatherLocation = location || "San Francisco";

    const response = await axios.get(
      `http://wttr.in/${encodeURIComponent(weatherLocation)}?format=j1`,
    );

    // Extract only the requested fields from current conditions
    const currentCondition = response.data.current_condition[0];
    const current = {
      temp_F: currentCondition.temp_F,
      humidity: currentCondition.humidity,
      localObsDateTime: currentCondition.localObsDateTime,
      weatherDesc: currentCondition.weatherDesc[0].value,
      pressure: currentCondition.pressure,
    };

    return NextResponse.json({
      location: weatherLocation,
      current,
      source: "wttr.in",
    });
  } catch (error) {
    console.error("Error getting weather data", {
      error,
      location: request.nextUrl.searchParams.get("location"),
    });

    return NextResponse.json(
      {
        error: "Failed to fetch weather data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
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
      return NextResponse.json({ error: "Location is required in request body" }, { status: 400 });
    }

    const response = await axios.get(`http://wttr.in/${encodeURIComponent(location)}?format=j1`);

    // Extract only the requested fields from current conditions
    const currentCondition = response.data.current_condition[0];
    const current = {
      temp_F: currentCondition.temp_F,
      humidity: currentCondition.humidity,
      localObsDateTime: currentCondition.localObsDateTime,
      weatherDesc: currentCondition.weatherDesc[0].value,
      pressure: currentCondition.pressure,
    };

    return NextResponse.json({
      location: location,
      current,
      source: "wttr.in",
    });
  } catch (error) {
    console.error("Error getting weather data (POST)", { error });

    return NextResponse.json(
      {
        error: "Failed to fetch weather data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
