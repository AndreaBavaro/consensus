import React, { useEffect, useState } from 'react';
import styles from './ProgressBar.module.css';

const STAGE_LABELS = {
  idle: 'Preparing...',
  connecting: 'Finding sources...',
  sources: 'Extracting comments, posts...',
  analyzing: 'Analyzing opinions...',
  comments: 'Processing comments...',
  insights: 'Generating insights...',
  finalizing: 'Finalizing results...',
  complete: 'Complete!'
};

const ProgressBar = ({ progress, isComplete }) => {
  const [visible, setVisible] = useState(true);
  const [animatedPercentage, setAnimatedPercentage] = useState(0);

  // Smoothly animate the percentage
  useEffect(() => {
    if (progress?.percentage !== undefined) {
      setAnimatedPercentage(progress.percentage);
    }
  }, [progress?.percentage]);

  // Hide after completion with delay
  useEffect(() => {
    if (isComplete || progress?.stage === 'complete') {
      const timer = setTimeout(() => {
        setVisible(false);
      }, 1500);
      return () => clearTimeout(timer);
    } else {
      setVisible(true);
    }
  }, [isComplete, progress?.stage]);

  if (!visible) return null;

  const stage = progress?.stage || 'idle';
  const percentage = animatedPercentage || 0;
  const label = STAGE_LABELS[stage] || 'Loading...';

  return (
    <div className={`${styles.progressContainer} ${stage === 'complete' ? styles.complete : ''}`}>
      <div className={styles.progressHeader}>
        <span className={styles.stageLabel}>{label}</span>
        <span className={styles.percentage}>{Math.round(percentage)}%</span>
      </div>
      <div className={styles.progressTrack}>
        <div 
          className={styles.progressFill}
          style={{ width: `${percentage}%` }}
        />
        <div className={styles.progressGlow} style={{ left: `${percentage}%` }} />
      </div>
    </div>
  );
};

export default ProgressBar;
