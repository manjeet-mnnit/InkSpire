import { useEffect, useRef, useState } from "react";
import { useGame } from "../../context/GameContext.jsx";

function getChatEntryClass(entry) {
  if (entry.kind === "system") {
    if (/guessed the word\./i.test(entry.message || "")) return "game-chat-entry is-system-success";
    if (/round ended/i.test(entry.message || "")) return "game-chat-entry is-system-warning";
    return "game-chat-entry is-system";
  }

  if (entry.kind === "guess") return "game-chat-entry is-guess";
  return "game-chat-entry";
}

export default function GameGuessCard() {
  const { gameState, canGuess, submitGuess, chatFeed, sendChatMessage } = useGame();
  const [messageInput, setMessageInput] = useState("");
  const chatScrollRef = useRef(null);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatFeed]);

  const canChat =
    Boolean(gameState) &&
    (gameState.status === "presenter-choosing" ||
      gameState.status === "round-ended");

  const isRoundActive = gameState?.status === "in-round";
  const isPresenterInRound = Boolean(isRoundActive && gameState?.isPresenter);

  const inputPlaceholder = !gameState
    ? "Waiting for game state..."
    : isRoundActive
      ? isPresenterInRound
        ? "You are drawing..."
        : "Type your guess"
      : canChat
        ? "Type a chat message"
        : "Chat unavailable in current state";

  const isInputDisabled = !gameState || isPresenterInRound || (!isRoundActive && !canChat);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!messageInput.trim()) return;

    if (isRoundActive) {
      if (!canGuess) return;

      const result = await submitGuess(messageInput);
      if (result?.ok === false) return;

      setMessageInput("");
      return;
    }

    const result = await sendChatMessage(messageInput);
    if (result?.ok === false) return;

    setMessageInput("");
  }

  return (
    <section className="card game-chat-panel">
      <h2>Chat</h2>

      <div className="game-chat-scroll" ref={chatScrollRef}>
        {chatFeed.length ? (
          <ul className="list game-chat-list">
            {chatFeed.map((entry, index) => (
              <li className={getChatEntryClass(entry)} key={`${entry.sentAt || "chat"}-${index}`}>
                {entry.kind === "system" ? (
                  <span>{entry.message}</span>
                ) : (
                  <>
                    <strong className="game-chat-author">{(entry.name || "Player").split(" ")[0]}: </strong>
                    <span className="game-chat-message">{entry.message}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No messages yet.</p>
        )}
      </div>

      {/* {visibleGuessResult ? <div className="note">{visibleGuessResult}</div> : null} */}

      <form className="game-chat-input-row" onSubmit={handleSubmit}>
        <input
          value={messageInput}
          onChange={(event) => {
            setMessageInput(event.target.value);
          }}
          placeholder={inputPlaceholder}
          disabled={isInputDisabled}
          hidden={isInputDisabled}
        />
        <button type="submit" hidden={isInputDisabled} disabled={isInputDisabled || !messageInput.trim()}>
          {isRoundActive ? "Guess" : "Send"}
        </button>
      </form>
    </section>
  );
}
