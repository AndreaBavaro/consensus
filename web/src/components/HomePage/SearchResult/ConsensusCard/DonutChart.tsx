import React, { useState, useEffect } from 'react';
import styles from './DonutChart.module.css';

const DonutChart = ({ percentage, isLoading }) => {
  const [displayPercentage, setDisplayPercentage] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  
  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  


  useEffect(() => {
    if (!isLoading && percentage !== null && percentage !== undefined) {
      const duration = 2000; // 2s to match CSS transition
      const startTime = performance.now();
      
      const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const t = progress;
        const bezier = (1 - Math.cos(t * Math.PI)) / 2; // Easing function
        
        const currentValue = percentage * bezier;
        setDisplayPercentage(Math.round(currentValue));
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } 
      };
      
      requestAnimationFrame(animate);
      
      return () => {
        setDisplayPercentage(0);
      };
    }
  }, [percentage, isLoading]);

  // SVG calculations
  const size = isMobile ? 50 : 80;
  const strokeWidth = isMobile ? 5 : 7;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  
  // Use normalized percentage for arc length, but display actual percentage
  const arcLength = (displayPercentage / 100) * circumference;
  const dashArray = `${arcLength} ${circumference}`;
  
  const chartClass = `${styles.chart} ${
    isLoading ? styles.loading :
    percentage !== null && percentage !== undefined ? styles.loaded : ''
  }`;

  return (
    <div className={styles.container}>
      <div className={chartClass}>
        <svg 
          className={styles.svg}
          width={size} 
          height={size} 
          viewBox={`0 0 ${size} ${size}`}
        >
          {/* Background circle */}
          <circle
            className={styles.background}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
          />
          
          {/* Percentage arc */}
          <circle
            className={styles.arc}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeDasharray={dashArray}
            strokeDashoffset={0}
            strokeLinecap="butt"
            transform={`rotate(180 ${center} ${center})`}
          />
        </svg>
        
        {/* Text container */}
        <div className={styles.textContainer}>
          {isLoading ? (
            <>
              <div className={styles.skeletonPercentage}></div>
              <div className={styles.skeletonLabel}></div>
            </>
          ) : (
            <>
              <div className={styles.percentage}>{displayPercentage}%</div>
              <div className={styles.label}>believe that</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DonutChart;
