import React from 'react';
import styles from './Sources.module.css';
import SourceCard from '../SourceCard/SourceCard';
import type { SearchSource } from '../../../../types';

interface SourcesProps {
  sources: SearchSource[];
  comments?: unknown[];
  isMinimized?: boolean;
  onExpandChange?: (expanded: boolean) => void;
}

const Sources = ({ sources }: SourcesProps) => {
  const showSkeletons = sources.length === 0;
  const gridClassName = `${styles.grid}`;

  return (
    <div className={styles.container}>
      <div className={gridClassName}>
        {showSkeletons ? (
          [0, 1, 2, 3].map((index) => (
            <SourceCard
              key={`skeleton-${index}`}
              isLoading={true}
              position={index % 2 === 0 ? 'left' : 'right'}
              style={{ '--index': index }}
            />
          ))
        ) : (
          sources.map((source, index) => (
            <SourceCard 
              key={source.link}
              title={source.title}
              link={source.link}
              subreddit={source.subreddit}
              position={index % 2 === 0 ? 'left' : 'right'}
              style={{ '--index': index }}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default Sources;
