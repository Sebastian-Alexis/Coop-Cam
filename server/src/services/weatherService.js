import { config } from '../config.js';

//weather cache configuration

//cache storage
let weatherCache = {
  data: null,
  timestamp: null
};

//weather icon mapping based on conditions
const getWeatherIcon = (shortForecast) => {
  const forecast = shortForecast.toLowerCase();
  
  if (forecast.includes('sunny') || forecast.includes('clear')) {
    return '☀️';
  } else if (forecast.includes('partly cloudy') || forecast.includes('partly sunny')) {
    return '⛅';
  } else if (forecast.includes('cloudy') || forecast.includes('overcast')) {
    return '☁️';
  } else if (forecast.includes('rain') || forecast.includes('shower')) {
    return '🌧️';
  } else if (forecast.includes('thunderstorm') || forecast.includes('thunder')) {
    return '⛈️';
  } else if (forecast.includes('snow')) {
    return '❄️';
  } else if (forecast.includes('fog') || forecast.includes('mist')) {
    return '🌫️';
  } else if (forecast.includes('wind')) {
    return '💨';
  } else {
    return '🌤️'; //default
  }
};

//fetch weather data from weather.gov
export async function fetchWeatherData(userAgent) {
  //check cache first
  if (weatherCache.data && weatherCache.timestamp) {
    const cacheAge = Date.now() - weatherCache.timestamp;
    if (cacheAge < config.WEATHER_CACHE_DURATION) {
      console.log(`Returning cached weather data (age: ${Math.round(cacheAge / 1000)}s)`);
      return weatherCache.data;
    }
  }

  try {
    //weather.gov requires a user agent header
    const headers = {
      'User-Agent': userAgent || 'Coop-Cam Weather Service (contact@example.com)',
      'Accept': 'application/json'
    };

    //use the direct grid point URL for configured location
    const forecastUrl = `https://api.weather.gov/gridpoints/${config.WEATHER_GRID_OFFICE}/${config.WEATHER_GRID_X},${config.WEATHER_GRID_Y}/forecast`;
    
    console.log(`Fetching weather from: ${forecastUrl}`);
    const response = await fetch(forecastUrl, { headers });

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    //extract the current period (first in the array)
    const currentPeriod = data.properties.periods[0];
    
    //format the weather data
    const weatherData = {
      temperature: currentPeriod.temperature,
      temperatureUnit: currentPeriod.temperatureUnit,
      conditions: currentPeriod.shortForecast,
      detailedForecast: currentPeriod.detailedForecast,
      windSpeed: currentPeriod.windSpeed,
      windDirection: currentPeriod.windDirection,
      icon: getWeatherIcon(currentPeriod.shortForecast),
      isDaytime: currentPeriod.isDaytime,
      humidity: currentPeriod.relativeHumidity?.value || null,
      timestamp: new Date().toISOString()
    };

    //update cache
    weatherCache = {
      data: weatherData,
      timestamp: Date.now()
    };

    console.log('Weather data fetched successfully:', weatherData.conditions);
    return weatherData;

  } catch (error) {
    console.error('Error fetching weather data:', error.message);
    
    //return cached data if available, even if expired
    if (weatherCache.data) {
      console.log('Returning stale cached data due to error');
      return { ...weatherCache.data, error: true };
    }
    
    //fallback data if no cache
    return {
      temperature: '--',
      temperatureUnit: 'F',
      conditions: 'Weather Unavailable',
      detailedForecast: 'Unable to fetch weather data',
      windSpeed: '--',
      windDirection: '--',
      icon: '❓',
      isDaytime: true,
      humidity: null,
      error: true,
      timestamp: new Date().toISOString()
    };
  }
}

//clear cache (useful for testing)
export function clearWeatherCache() {
  weatherCache = {
    data: null,
    timestamp: null
  };
  console.log('Weather cache cleared');
}

//get cache status
export function getCacheStatus() {
  if (!weatherCache.timestamp) {
    return { cached: false };
  }
  
  const age = Date.now() - weatherCache.timestamp;
  return {
    cached: true,
    ageSeconds: Math.round(age / 1000),
    expired: age > config.WEATHER_CACHE_DURATION
  };
}

//export weatherCache for testing
export { weatherCache };