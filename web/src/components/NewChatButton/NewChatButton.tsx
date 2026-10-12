import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import styles from './NewChatButton.module.css';
import { useSession } from '../../context/SessionContext';

const NewChatButton = () => {
  const navigate = useNavigate();
  const { setSessionId, setMessagesArray, setCurrentQuery } = useSession();

  const handleNewChat = () => {
    setSessionId(null);
    setMessagesArray([]);
    setCurrentQuery(null);
    navigate('/');
  };

  return (
    <button className={styles.newChatButton} onClick={handleNewChat}>
      <FontAwesomeIcon icon={faPlus} className={styles.plusIcon} />
      <span>New Chat</span>
    </button>
  );
};

export default NewChatButton;
