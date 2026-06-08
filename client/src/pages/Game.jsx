import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GameProvider } from "../context/GameContext.jsx";
import { useGame } from "../context/GameContext.jsx";
import { useLobby } from "../context/LobbyContext.jsx";
import GameTopBar from "../components/game/GameTopBar.jsx";
import GameWordCard from "../components/game/GameWordCard.jsx";
import GameGuessCard from "../components/game/GameGuessCard.jsx";
import GameCanvasCard from "../components/game/GameCanvasCard.jsx";
import GameScoreboardCard from "../components/game/GameScoreboardCard.jsx";
import GameOverOverlay from "../components/game/GameOverOverlay.jsx";

const ALLOWED_GAME_ROUTE_STATUSES = new Set([
  "presenter-choosing",
  "in-round",
  "round-ended",
  "game-over"
]);

function GameLayoutContent() {
  const { gameState, isGameOver } = useGame();
  const { lobbyState, lastGameState } = useLobby();
  const navigate = useNavigate();
  const resolvedStatus = gameState?.status || lastGameState?.status || null;
  const [isPlayersDrawerOpen, setIsPlayersDrawerOpen] = useState(false);

  useEffect(() => {
    if (!lobbyState?.id) {
      navigate("/", { replace: true });
      return;
    }

    if (resolvedStatus && !ALLOWED_GAME_ROUTE_STATUSES.has(resolvedStatus)) {
      navigate("/", { replace: true });
    }
  }, [lobbyState?.id, resolvedStatus, navigate]);

  return (
    <div className="game-page">
      <GameTopBar onOpenPlayers={() => setIsPlayersDrawerOpen(true)} />

      <div className="game-layout">
        <aside className="game-left">
          <GameScoreboardCard />
        </aside>

        <section className="game-center">
          <GameCanvasCard />
        </section>

        <aside className="game-right">
          <GameGuessCard />
        </aside>
      </div>

      {isPlayersDrawerOpen ? (
        <div className="players-drawer-root" role="dialog" aria-modal="true" aria-label="Players">
          <button
            type="button"
            className="players-drawer-backdrop"
            onClick={() => setIsPlayersDrawerOpen(false)}
            aria-label="Close players"
          />
          <div className="players-drawer-panel">
            <button
              type="button"
              className="secondary players-drawer-close"
              onClick={() => setIsPlayersDrawerOpen(false)}
              aria-label="Close players"
            >
              X
            </button>
            <GameScoreboardCard />
          </div>
        </div>
      ) : null}

      <GameWordCard />
      {isGameOver ? <GameOverOverlay /> : null}
    </div>
  );
}

export default function Game() {
  return (
    <GameProvider>
      <GameLayoutContent />
    </GameProvider>
  );
}
