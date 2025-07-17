// Weather Widget Module
// Handles weather data fetching and display

class WeatherWidget {
  constructor() {
    this.weatherContent = null;
    this.updateInterval = null;
  }
  
  initialize() {
    this.weatherContent = document.getElementById('weatherContent');
    
    if (!this.weatherContent) {
      console.error('Weather content element not found');
      return;
    }
    
    // Initial weather update
    this.updateWeather();
    
    // Update weather every 5 minutes
    this.updateInterval = setInterval(() => this.updateWeather(), 5 * 60 * 1000);
  }
  
  async updateWeather() {
    try {
      const response = await fetch('/api/weather');
      const result = await response.json();
      
      if (result.success && result.data) {
        const weather = result.data;
        
        // Determine weather icon based on conditions
        const { iconSvg, iconColor } = this.getWeatherIcon(weather.conditions);
        
        this.weatherContent.innerHTML = `
          ${iconSvg}
          <div>
            <div class="font-semibold">${weather.temperature}°${weather.temperatureUnit}</div>
            <div class="text-sm text-base-content/70">${weather.conditions}</div>
          </div>
        `;
        
        // Add title attribute for detailed forecast on hover
        this.weatherContent.parentElement.title = weather.detailedForecast;
      } else {
        this.showErrorState('Unavailable');
      }
    } catch (error) {
      console.error('Failed to fetch weather:', error);
      this.showErrorState('Error');
    }
  }
  
  getWeatherIcon(conditions) {
    const conditionsLower = conditions.toLowerCase();
    let iconColor = 'text-warning';
    let iconSvg = '';
    
    if (conditionsLower.includes('sunny') || conditionsLower.includes('clear')) {
      // Sun icon
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 ${iconColor}">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
      </svg>`;
    } else if (conditionsLower.includes('cloud')) {
      // Cloud icon
      iconColor = 'text-base-content/60';
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 ${iconColor}">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
      </svg>`;
    } else if (conditionsLower.includes('rain') || conditionsLower.includes('shower')) {
      // Rain icon
      iconColor = 'text-info';
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 ${iconColor}">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 19.5v1.5m3-3v3m3-4.5v4.5" />
      </svg>`;
    } else if (conditionsLower.includes('storm')) {
      // Storm icon
      iconColor = 'text-warning';
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 ${iconColor}">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>`;
    } else {
      // Default sun icon for unknown conditions
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 ${iconColor}">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
      </svg>`;
    }
    
    return { iconSvg, iconColor };
  }
  
  showErrorState(message) {
    this.weatherContent.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 text-base-content/30">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
      <div>
        <div class="font-semibold">--°F</div>
        <div class="text-sm text-base-content/70">${message}</div>
      </div>
    `;
  }
  
  // Cleanup method
  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}

// Export for use in other modules
export default WeatherWidget;