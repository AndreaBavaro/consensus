const colors = ['blue', 'yellow', 'purple', 'red', 'green', 'teal', 'pink'];

// Keep track of theme positions
let themePositions = new Map();
let nextPosition = 0;

export const getThemeColor = (themeName) => {
  // Return default gray for scored comments
  if (themeName === 'default' || themeName === 'none') {
    return 'default';
  }

  // If we haven't seen this theme before, assign it the next position
  if (!themePositions.has(themeName)) {
    themePositions.set(themeName, nextPosition);
    nextPosition = (nextPosition + 1) % colors.length;
  }
  
  // Use the theme's assigned position to get its color
  return colors[themePositions.get(themeName)];
};
