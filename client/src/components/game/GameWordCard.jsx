import { useGame } from "../../context/GameContext.jsx";

export default function GameWordCard() {
  const { gameState, chooseWord } = useGame();

  if (gameState?.status !== "presenter-choosing") return null;

  return (
    <div className="word-overlay-root" role="dialog" aria-modal="true" aria-label="Choose a word">
      <div className="word-overlay-backdrop" />
      <div className="word-overlay-panel card">
        {gameState.isPresenter ? (
          <>
            <div className="word-overlay-header">
              <h2>Pick Your Word</h2>
              <p className="muted">Choose a word to draw for this round.</p>
            </div>
            <div className="word-overlay-options">
              {(gameState.wordOptions || []).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="word-overlay-option"
                  onClick={() => chooseWord(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="word-overlay-header">
            <h2>Get Ready!</h2>
            <p className="muted">Waiting for the presenter to choose a word&hellip;</p>
            <div className="word-overlay-loader">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
