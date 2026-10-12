import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useSession } from '../../../context/SessionContext';

import { 
  faGlobe,
  faComputer,
  faGraduationCap,
  faMountainSun,
  faBrain
} from '@fortawesome/free-solid-svg-icons';
import styles from './SuggestionCards.module.css';

const suggestions = [
  {
    icon: faGlobe,
    title: "Does social media make us lonelier?",
    query: "does social media make us more lonely",
    color: "#3B82F6"  // Blue
  },
  {
    icon: faGraduationCap,
    title: "Is college still worth it?",
    query: "is college still worth it",
    color: "#8B5CF6"  // Purple
  },
  {
    icon: faMountainSun,
    title: "Most beautiful places in California?",
    query: "what are the most beautiful places in california",
    color: "#F59E0B"  // Amber
  },
  {
    icon: faBrain,
    title: "Do algorithms control what we think?",
    query: "do algorithms control what we think",
    color: "#EF4444"  // Red
  },
  {
    icon: faComputer,
    title: "How to get a CS internship?",
    query: "how to get a CS internship",
    color: "#10B981"  // Emerald
  },
];

const SuggestionCards = () => {
  const navigate = useNavigate();
  const { setCurrentQueryWithDates, addMessage } = useSession();

  const handleCardClick = async (query) => {
    try {
      // Send query without any date filters
      setCurrentQueryWithDates(query, null, null, 'all');
      addMessage(query, null, null, 'all');
      navigate('/search');
    } catch (error) {
      console.error('Error initiating search:', error);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {suggestions.map((item, index) => (
          <button
            key={index}
            className={styles.card}
            onClick={() => handleCardClick(item.query)}
          >
            <FontAwesomeIcon 
              icon={item.icon} 
              className={styles.icon}
              style={{ color: item.color }}
            />
            <span className={styles.title}>{item.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SuggestionCards;
