import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../../context/GameContext.jsx";
import { useLobby } from "../../context/LobbyContext.jsx";

function getVisibleTimerSec(gameState) {
  if (!gameState) return null;

  if (gameState.status === "presenter-choosing") {
    return gameState.presenterChoiceRemainingSec ?? null;
  }

  return gameState.timeRemainingSec ?? null;
}

function buildWordHint(gameState, hintState) {
  if (!gameState) return "_ _ _ _";
  if (gameState.isPresenter && gameState.word) return gameState.word.toUpperCase();
  if (hintState?.mask) return hintState.mask;
  if (typeof gameState.wordLength === "number" && gameState.wordLength > 0) {
    return Array.from({ length: gameState.wordLength }).map(() => "_").join(" ");
  }
  return "_ _ _ _";
}

export default function GameTopBar({ onOpenPlayers }) {
  const { gameState, hintState, gameError, presenterTimeoutNotice, wordReveal, setGameError } = useGame();
  const { leaveLobby } = useLobby();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSoundOn, setIsSoundOn] = useState(true);
  const [isLeavingRoom, setIsLeavingRoom] = useState(false);
  const [visibleTimerSec, setVisibleTimerSec] = useState(null);

  const wordHint = useMemo(() => buildWordHint(gameState, hintState), [gameState, hintState]);

  useEffect(() => {
    const nextTimerSec = getVisibleTimerSec(gameState);
    setVisibleTimerSec(nextTimerSec);

    if (nextTimerSec === null) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setVisibleTimerSec((current) => {
        if (current === null || current <= 0) return current;
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [gameState?.status, gameState?.timeRemainingSec, gameState?.presenterChoiceRemainingSec]);

  async function handleLeaveRoom() {
    if (isLeavingRoom) return;

    setIsLeavingRoom(true);
    const result = await leaveLobby();

    if (result?.ok === false) {
      setGameError(result.error || "Unable to leave the room");
      setIsLeavingRoom(false);
      return;
    }

    setIsMenuOpen(false);
    setIsLeavingRoom(false);
    navigate("/", { replace: true });
  }

  return (
    <section className="card game-topbar fade-up">
      <div className="game-topbar-row">
        <div className="game-clock-block">
          <strong className="game-clock-value">
            {visibleTimerSec !== null && visibleTimerSec !== undefined
              ? `${visibleTimerSec}s`
              : "--"}
          </strong>
        </div>

        <div className="game-hint-block">
          <strong className="game-hint-value">{wordHint}</strong>
        </div>

        <div className="game-round-block">
          <span className="game-round-value">
            Round {gameState?.round ?? 0}/{gameState?.settings?.maxRounds ?? "-"}
          </span>

          <button
            type="button"
            className="secondary game-players-btn"
            onClick={onOpenPlayers}
            aria-label="Open players"
            title="Players"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 11a4 4 0 1 0-8 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M18 8.5a3 3 0 0 1 2 5.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M21 21a5.5 5.5 0 0 0-3-4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          <div className="game-menu-wrap">
            <button
              type="button"
              className="secondary game-menu-btn"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              aria-label="Open game menu"
            >
              ⚙
            </button>

            {isMenuOpen ? (
              <div className="game-menu-popover">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setIsSoundOn((prev) => !prev)}
                >
                  {isSoundOn ? "Mute Sound" : "Unmute Sound"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={handleLeaveRoom}
                  disabled={isLeavingRoom}
                >
                  {isLeavingRoom ? "Leaving..." : "Leave Room"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {presenterTimeoutNotice ? (
        <div className="note">Presenter timed out. A word was auto-selected.</div>
      ) : null}
      {wordReveal?.word ? <div className="note">Word revealed: {wordReveal.word}</div> : null}
      {gameError ? <div className="error">{gameError}</div> : null}
    </section>
  );
}
