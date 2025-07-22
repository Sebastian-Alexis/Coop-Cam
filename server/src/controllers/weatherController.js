//weather controller - business logic for weather data operations
//factory function receives dependencies for clean testing and modularity

export const createWeatherController = ({ weatherService, config }) => {
  if (!weatherService) {
    throw new Error('WeatherController: weatherService dependency is required.');
  }
  if (!config) {
    throw new Error('WeatherController: config dependency is required.');
  }

  //get weather data with caching and mobile optimization
  const getWeather = async (req, res) => {
    try {
      const weatherData = await weatherService.fetchWeatherData(config.WEATHER_USER_AGENT);
      const cacheStatus = weatherService.getCacheStatus();
      
      //mobile-specific caching
      if (req.isMobile) {
        res.set({
          'Cache-Control': 'private, max-age=300', //cache for 5 minutes on mobile
          'X-Mobile-Optimized': 'true'
        });
      }
      
      res.json({
        success: true,
        data: weatherData,
        cache: cacheStatus
      });
    } catch (error) {
      console.error('[Weather] API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch weather data',
        message: error.message
      });
    }
  };

  return {
    getWeather
  };
};