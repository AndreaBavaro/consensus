import React from 'react';
import styles from './DateBadge.module.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClock } from '@fortawesome/free-solid-svg-icons';

const DateBadge = ({ dateFilter = 'all', fromDate, toDate }) => {
  const formatDate = (dateStr) => {
    try {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (error) {
      console.error('Date formatting error:', error);
      return '';
    }
  };

  const getDateDisplay = () => {
    switch(dateFilter) {
      case '24h': return 'Last 24 hours';
      case 'week': return 'Past week';
      case 'month': return 'Past month';
      case 'year': return 'Past year';
      case 'custom':
        const from = formatDate(fromDate);
        const to = formatDate(toDate);
        return from && to ? `${from} - ${to}` : 'Custom range';
      case 'all':
      default:
        return 'Most Recent';
    }
  };
  
  return (
    <div className={styles.dateBadgeWrapper}>
      <FontAwesomeIcon 
        icon={faClock} 
        className={styles.icon}
      />
      <span className={styles.dateBadge}>
        {getDateDisplay()}
      </span>
    </div>
  );
};

export default DateBadge;
