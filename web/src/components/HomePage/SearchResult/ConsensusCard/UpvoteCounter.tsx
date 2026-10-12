import React, { useState, useEffect, useRef } from 'react';
import styles from './UpvoteCounter.module.css';

const UpvoteCounter = React.forwardRef<{ getCounterElement: () => HTMLDivElement | null }, { upvotes: number }>(({ upvotes }, ref) => {
  const [displayNumber, setDisplayNumber] = useState(upvotes);
  const [isAnimating, setIsAnimating] = useState(false);
  const previousUpvotes = useRef(upvotes);
  const counterRef = useRef(null);

  // Merge refs
  React.useImperativeHandle(ref, () => ({
    getCounterElement: () => counterRef.current
  }));

  useEffect(() => {
    if (upvotes === previousUpvotes.current) return;

    const start = previousUpvotes.current;
    const end = upvotes;
    const steps = Math.min(Math.abs(end - start), 12);
    const stepDuration = 1000 / steps;

    setIsAnimating(true);
    let step = 0;
    
    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      const currentValue = Math.round(start + (end - start) * progress);
      setDisplayNumber(currentValue);

      if (step === steps) {
        clearInterval(timer);
        setIsAnimating(false);
        previousUpvotes.current = upvotes;
      }
    }, stepDuration);

    return () => clearInterval(timer);
  }, [upvotes]);

  const formatNumber = (num) => {
    if (num >= 1000) {
      return `${Math.floor(num / 1000)}k`;
    }
    return num.toString();
  };

  return (
    <div 
      ref={counterRef}
      className={`${styles.counter} ${isAnimating ? styles.animating : ''}`}
    >
      <div className={styles.column}>
        <svg 
          className={styles.arrow} 
          width="32" 
          height="16" 
          viewBox="0 0 32 16" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
        >
          <path 
            d="M16 0L32 16H0L16 0Z" 
            fill="#46D160"
            stroke="#46D160"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
        <span className={styles.label}>upvotes</span>
      </div>
      <span className={styles.number}>
        {formatNumber(displayNumber)}
      </span>
    </div>
  );
});

UpvoteCounter.displayName = 'UpvoteCounter';

export default UpvoteCounter;
