import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import type { Puzzle, PuzzleManifest, TrainerStats } from "./types";

type TrainerStatus = "loading" | "idle" | "solving" | "solved" | "error";
type Difficulty = "all" | "easy" | "medium" | "hard";

const INITIAL_STATS: TrainerStats = {
  score: 0,
  streak: 0,
  solved: 0,
  failed: 0,
  seenIds: [],
};

const PIECES: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const THEME_LABELS: Record<string, string> = {
  advantage: "Giành lợi thế",
  attraction: "Thu hút",
  discoveredAttack: "Tấn công khám phá",
  endgame: "Tàn cuộc",
  fork: "Đòn nĩa",
  long: "Chuỗi dài",
  master: "Trình độ cao",
  mate: "Chiếu hết",
  mateIn1: "Chiếu hết 1 nước",
  mateIn2: "Chiếu hết 2 nước",
  middlegame: "Trung cuộc",
  opening: "Khai cuộc",
  pin: "Ghim quân",
  sacrifice: "Hy sinh",
  short: "Chuỗi ngắn",
  veryLong: "Chuỗi rất dài",
};

function applyUci(game: Chess, uci: string) {
  return game.move({
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: (uci[4] || undefined) as PieceSymbol | undefined,
  });
}

function moveToUci(move: ReturnType<Chess["move"]>) {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

function readStats(): TrainerStats {
  try {
    const raw = localStorage.getItem("nuoc-hay-stats");
    return raw ? { ...INITIAL_STATS, ...JSON.parse(raw) } : INITIAL_STATS;
  } catch {
    return INITIAL_STATS;
  }
}

function fitsDifficulty(puzzle: Puzzle, difficulty: Difficulty) {
  if (difficulty === "easy") return puzzle.rating < 1300;
  if (difficulty === "medium") return puzzle.rating >= 1300 && puzzle.rating < 1900;
  if (difficulty === "hard") return puzzle.rating >= 1900;
  return true;
}

function shardFitsDifficulty(
  shard: PuzzleManifest["shards"][number],
  difficulty: Difficulty,
) {
  if (difficulty === "easy") return shard.minRating < 1300;
  if (difficulty === "medium") return shard.minRating < 1900 && shard.maxRating >= 1300;
  if (difficulty === "hard") return shard.maxRating >= 1900;
  return true;
}

function ChessBoard({
  fen,
  orientation,
  disabled,
  hintSquare,
  lastMove,
  onMove,
}: {
  fen: string;
  orientation: Color;
  disabled: boolean;
  hintSquare: Square | null;
  lastMove: [Square, Square] | null;
  onMove: (from: Square, to: Square) => void;
}) {
  const [selected, setSelected] = useState<Square | null>(null);
  const game = useMemo(() => new Chess(fen), [fen]);
  const files = orientation === "w" ? "abcdefgh".split("") : "hgfedcba".split("");
  const ranks = orientation === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];

  useEffect(() => setSelected(null), [fen, disabled]);

  const legalTargets = useMemo(() => {
    if (!selected || disabled) return new Set<string>();
    return new Set(
      game.moves({ square: selected, verbose: true }).map((move) => move.to),
    );
  }, [disabled, game, selected]);

  function selectOrMove(square: Square) {
    if (disabled) return;
    const piece = game.get(square);
    if (selected) {
      if (square === selected) {
        setSelected(null);
      } else if (legalTargets.has(square)) {
        onMove(selected, square);
        setSelected(null);
      } else if (piece?.color === game.turn()) {
        setSelected(square);
      } else {
        setSelected(null);
      }
    } else if (piece?.color === game.turn()) {
      setSelected(square);
    }
  }

  return (
    <div className="board-shell" aria-label="Bàn cờ">
      <div className="board">
        {ranks.flatMap((rank) =>
          files.map((file) => {
            const square = `${file}${rank}` as Square;
            const piece = game.get(square);
            const light = (files.indexOf(file) + ranks.indexOf(rank)) % 2 === 0;
            const isLast = lastMove?.includes(square) ?? false;
            const classNames = [
              "square",
              light ? "square-light" : "square-dark",
              selected === square ? "is-selected" : "",
              legalTargets.has(square) ? "is-target" : "",
              hintSquare === square ? "is-hint" : "",
              isLast ? "is-last" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                className={classNames}
                data-square={square}
                key={square}
                onClick={() => selectOrMove(square)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = event.dataTransfer.getData("text/plain") as Square;
                  if (from) onMove(from, square);
                }}
                aria-label={`${square}${piece ? ` ${piece.color === "w" ? "trắng" : "đen"} ${piece.type}` : ""}`}
                type="button"
              >
                {piece && (
                  <span
                    className={`piece piece-${piece.color}`}
                    draggable={!disabled && piece.color === game.turn()}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", square);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    {PIECES[piece.color][piece.type]}
                  </span>
                )}
                {file === files[0] && <span className="rank-label">{rank}</span>}
                {rank === ranks[ranks.length - 1] && <span className="file-label">{file}</span>}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}

function App() {
  const gameRef = useRef(new Chess());
  const attemptFailed = useRef(false);
  const currentShard = useRef<string | null>(null);
  const [manifest, setManifest] = useState<PuzzleManifest | null>(null);
  const [library, setLibrary] = useState<Puzzle[]>([]);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [orientation, setOrientation] = useState<Color>("w");
  const [moveIndex, setMoveIndex] = useState(1);
  const [status, setStatus] = useState<TrainerStatus>("loading");
  const [message, setMessage] = useState("Đang mở kho bài tập…");
  const [difficulty, setDifficulty] = useState<Difficulty>("all");
  const [theme, setTheme] = useState("all");
  const [stats, setStats] = useState<TrainerStats>(readStats);
  const [hintSquare, setHintSquare] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<[Square, Square] | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [isOpponentMoving, setIsOpponentMoving] = useState(false);

  useEffect(() => {
    localStorage.setItem("nuoc-hay-stats", JSON.stringify(stats));
  }, [stats]);

  const preparePuzzle = useCallback((next: Puzzle) => {
    try {
      const game = new Chess(next.fen);
      if (!next.moves[0]) throw new Error("Puzzle thiếu nước khởi tạo");
      applyUci(game, next.moves[0]);
      gameRef.current = game;
      setPuzzle(next);
      setFen(game.fen());
      setOrientation(game.turn());
      setMoveIndex(1);
      setStatus("idle");
      setMessage(`${game.turn() === "w" ? "Trắng" : "Đen"} đi — tìm nước tốt nhất`);
      setHintSquare(null);
      setLastMove([next.moves[0].slice(0, 2) as Square, next.moves[0].slice(2, 4) as Square]);
      setPendingPromotion(null);
      setIsOpponentMoving(false);
      attemptFailed.current = false;
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage("Bài tập này bị lỗi dữ liệu. Hãy chọn bài khác.");
    }
  }, []);

  const loadShard = useCallback(
    async (nextManifest: PuzzleManifest, nextDifficulty: Difficulty, nextTheme: string) => {
      const candidates = nextManifest.shards.filter(
        (item) =>
          item.count > 0 &&
          shardFitsDifficulty(item, nextDifficulty) &&
          (nextTheme === "all" || item.themes.includes(nextTheme)),
      );
      if (!candidates.length) throw new Error("Không có shard phù hợp với bộ lọc");
      const freshCandidates = candidates.filter((item) => item.file !== currentShard.current);
      const pool = freshCandidates.length ? freshCandidates : candidates;
      const shard = pool[Math.floor(Math.random() * pool.length)];
      const base = import.meta.env.BASE_URL;
      const response = await fetch(`${base}puzzles/${shard.file}`);
      if (!response.ok) throw new Error("Không tải được shard");
      const puzzles = (await response.json()) as Puzzle[];
      const matching = puzzles.filter(
        (item) =>
          fitsDifficulty(item, nextDifficulty) &&
          (nextTheme === "all" || item.themes.includes(nextTheme)),
      );
      const choices = matching.length ? matching : puzzles;
      const first = choices[Math.floor(Math.random() * choices.length)];
      if (!first) throw new Error("Shard đang trống");
      currentShard.current = shard.file;
      setLibrary(puzzles);
      preparePuzzle(first);
    },
    [preparePuzzle],
  );

  const choosePuzzle = useCallback(
    (source = library, nextDifficulty = difficulty, nextTheme = theme) => {
      const matching = source.filter(
        (item) =>
          fitsDifficulty(item, nextDifficulty) &&
          (nextTheme === "all" || item.themes.includes(nextTheme)),
      );
      if (!matching.length && manifest) {
        void loadShard(manifest, nextDifficulty, nextTheme).catch((error) => {
          console.error(error);
          setStatus("error");
          setMessage("Không thể tải nhóm bài phù hợp.");
        });
        return;
      }
      const pool = matching;
      if (!pool.length) return;
      const unseen = pool.filter((item) => !stats.seenIds.includes(item.id));
      if (!unseen.length && manifest && manifest.shards.length > 1) {
        void loadShard(manifest, nextDifficulty, nextTheme).catch(console.error);
        return;
      }
      const candidates = unseen.length ? unseen : pool;
      const next = candidates[Math.floor(Math.random() * candidates.length)];
      preparePuzzle(next);
    },
    [difficulty, library, loadShard, manifest, preparePuzzle, stats.seenIds, theme],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadPuzzles() {
      try {
        const base = import.meta.env.BASE_URL;
        const manifestResponse = await fetch(`${base}puzzles/manifest.json`);
        if (!manifestResponse.ok) throw new Error("Không tải được manifest");
        const nextManifest = (await manifestResponse.json()) as PuzzleManifest;
        if (!cancelled) {
          setManifest(nextManifest);
          await loadShard(nextManifest, "all", "all");
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setStatus("error");
          setMessage("Không thể mở kho bài tập. Hãy kiểm tra lại dữ liệu.");
        }
      }
    }
    void loadPuzzles();
    return () => {
      cancelled = true;
    };
  }, [loadShard]);

  const availableThemes = useMemo(() => {
    const themes = new Set(library.flatMap((item) => item.themes));
    return [...themes]
      .filter((item) => THEME_LABELS[item])
      .sort((a, b) => THEME_LABELS[a].localeCompare(THEME_LABELS[b], "vi"));
  }, [library]);

  const finishPuzzle = useCallback(() => {
    if (!puzzle) return;
    const gain = Math.max(8, Math.round(puzzle.rating / 120)) - (attemptFailed.current ? 4 : 0);
    setStatus("solved");
    setMessage(attemptFailed.current ? "Đúng rồi! Bạn đã sửa được nước đi." : "Tuyệt! Bạn đã giải chính xác.");
    setStats((current) => ({
      ...current,
      score: current.score + gain,
      streak: attemptFailed.current ? 0 : current.streak + 1,
      solved: current.solved + 1,
      seenIds: [...new Set([...current.seenIds, puzzle.id])].slice(-5000),
    }));
  }, [puzzle]);

  const playUserMove = useCallback(
    (from: Square, to: Square, promotion?: PieceSymbol) => {
      if (!puzzle || status !== "solving" || isOpponentMoving) return;
      const game = gameRef.current;
      let move: ReturnType<Chess["move"]>;
      try {
        move = game.move({ from, to, promotion });
      } catch {
        setMessage("Nước này không hợp lệ.");
        return;
      }

      const actual = moveToUci(move);
      const expected = puzzle.moves[moveIndex];
      const alternateMate = puzzle.themes.includes("mateIn1") && game.isCheckmate();
      if (actual !== expected && !alternateMate) {
        game.undo();
        setFen(game.fen());
        setMessage("Chưa đúng — thử một nước khác nhé.");
        setHintSquare(null);
        if (!attemptFailed.current) {
          attemptFailed.current = true;
          setStats((current) => ({
            ...current,
            failed: current.failed + 1,
            streak: 0,
            score: Math.max(0, current.score - 2),
          }));
        }
        return;
      }

      setFen(game.fen());
      setLastMove([from, to]);
      setHintSquare(null);
      const replyIndex = moveIndex + 1;
      if (alternateMate || replyIndex >= puzzle.moves.length) {
        finishPuzzle();
        return;
      }

      setMessage("Chính xác!");
      setIsOpponentMoving(true);
      window.setTimeout(() => {
        try {
          const reply = puzzle.moves[replyIndex];
          applyUci(game, reply);
          gameRef.current = game;
          setFen(game.fen());
          setLastMove([reply.slice(0, 2) as Square, reply.slice(2, 4) as Square]);
          const nextIndex = replyIndex + 1;
          setMoveIndex(nextIndex);
          if (nextIndex >= puzzle.moves.length) {
            finishPuzzle();
          } else {
            setMessage("Đối thủ đã đi — tiếp tục tìm nước tốt nhất.");
          }
        } catch (error) {
          console.error(error);
          setStatus("error");
          setMessage("Chuỗi đáp án của bài này bị lỗi.");
        } finally {
          setIsOpponentMoving(false);
        }
      }, 420);
    },
    [finishPuzzle, isOpponentMoving, moveIndex, puzzle, status],
  );

  function requestMove(from: Square, to: Square) {
    const piece = gameRef.current.get(from);
    const reachesLastRank = piece?.type === "p" && (to[1] === "1" || to[1] === "8");
    if (reachesLastRank) {
      setPendingPromotion({ from, to });
      return;
    }
    playUserMove(from, to);
  }

  const progress = puzzle ? Math.min(100, Math.round((moveIndex / puzzle.moves.length) * 100)) : 0;
  const sideLabel = orientation === "w" ? "Trắng" : "Đen";

  return (
    <main className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Nước Hay — trang chủ">
          <span className="brand-mark">♞</span>
          <span>
            <strong>Nước Hay</strong>
            <small>Luyện cờ mỗi ngày</small>
          </span>
        </a>
        <div className="top-score" aria-label={`Điểm hiện tại ${stats.score}`}>
          <span>Điểm</span>
          <strong>{stats.score.toLocaleString("vi-VN")}</strong>
        </div>
      </header>

      <section className="trainer-layout">
        <div className="board-column">
          <div className="board-heading">
            <div>
              <span className="eyebrow">Bài #{puzzle?.id ?? "—"}</span>
              <h1>{sideLabel} đi trước</h1>
            </div>
            <span className="rating-pill">{puzzle?.rating ?? "—"} Elo</span>
          </div>

          <ChessBoard
            fen={fen}
            orientation={orientation}
            disabled={status !== "solving" || isOpponentMoving}
            hintSquare={hintSquare}
            lastMove={lastMove}
            onMove={requestMove}
          />

          <div className={`feedback feedback-${status}`} role="status" aria-live="polite">
            <span className="feedback-icon">
              {status === "solved" ? "✓" : status === "error" ? "!" : isOpponentMoving ? "…" : "♟"}
            </span>
            <span>{message}</span>
          </div>
        </div>

        <aside className="control-panel">
          <section className="stats-card">
            <div className="streak-orb">
              <span>Chuỗi</span>
              <strong>{stats.streak}</strong>
            </div>
            <div className="progress-area">
              <div className="progress-copy">
                <span>Tiến độ bài</span>
                <strong>{progress}%</strong>
              </div>
              <div className="progress-track" aria-label={`Tiến độ ${progress}%`}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <small>{stats.solved} bài đã giải · {stats.failed} lần thử sai</small>
            </div>
          </section>

          <section className="filters-card">
            <div className="section-title">
              <span>Tùy chọn luyện tập</span>
              <small>{manifest?.total.toLocaleString("vi-VN") ?? "—"} bài trong kho</small>
            </div>
            <label>
              Độ khó
              <select
                value={difficulty}
                onChange={(event) => {
                  const value = event.target.value as Difficulty;
                  setDifficulty(value);
                  if (manifest) void loadShard(manifest, value, theme).catch(console.error);
                  else choosePuzzle(library, value, theme);
                }}
              >
                <option value="all">Mọi trình độ</option>
                <option value="easy">Dễ · dưới 1300</option>
                <option value="medium">Vừa · 1300–1899</option>
                <option value="hard">Khó · từ 1900</option>
              </select>
            </label>
            <label>
              Chủ đề
              <select
                value={theme}
                onChange={(event) => {
                  const value = event.target.value;
                  setTheme(value);
                  if (manifest) void loadShard(manifest, difficulty, value).catch(console.error);
                  else choosePuzzle(library, difficulty, value);
                }}
              >
                <option value="all">Tất cả chiến thuật</option>
                {availableThemes.map((item) => (
                  <option key={item} value={item}>{THEME_LABELS[item]}</option>
                ))}
              </select>
            </label>
          </section>

          <div className="actions">
            {status === "idle" && (
              <button className="primary-button" onClick={() => setStatus("solving")} type="button">
                Bắt đầu giải
              </button>
            )}
            {status === "solving" && (
              <button
                className="secondary-button"
                onClick={() => {
                  const expected = puzzle?.moves[moveIndex];
                  if (!expected) return;
                  setHintSquare(expected.slice(0, 2) as Square);
                  setMessage("Gợi ý: hãy nhìn quân đang được đánh dấu.");
                  setStats((current) => ({ ...current, score: Math.max(0, current.score - 1) }));
                }}
                type="button"
              >
                Gợi ý nước đi
              </button>
            )}
            {(status === "solved" || status === "error") && (
              <button className="primary-button" onClick={() => choosePuzzle()} type="button">
                Bài tiếp theo
              </button>
            )}
          </div>

          <div className="theme-list">
            {puzzle?.themes.slice(0, 4).map((item) => (
              <span key={item}>{THEME_LABELS[item] ?? item}</span>
            ))}
          </div>
        </aside>
      </section>

      {pendingPromotion && (
        <div className="modal-backdrop" role="presentation">
          <div className="promotion-modal" role="dialog" aria-modal="true" aria-label="Chọn quân phong cấp">
            <p>Chọn quân phong cấp</p>
            <div>
              {(["q", "r", "b", "n"] as PieceSymbol[]).map((piece) => (
                <button
                  key={piece}
                  onClick={() => {
                    playUserMove(pendingPromotion.from, pendingPromotion.to, piece);
                    setPendingPromotion(null);
                  }}
                  type="button"
                >
                  {PIECES[gameRef.current.turn()][piece]}
                </button>
              ))}
            </div>
            <button className="cancel-promotion" onClick={() => setPendingPromotion(null)} type="button">
              Hủy
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
