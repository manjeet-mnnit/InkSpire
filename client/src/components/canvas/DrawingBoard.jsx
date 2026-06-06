import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, Ellipse, Line, PencilBrush, Rect } from "fabric";

const DEFAULT_BRUSH_COLOR = "#171717";
const DEFAULT_BRUSH_SIZE = 6;
const UPDATE_DEBOUNCE_MS = 80;
const PRESET_COLORS = [
	"#171717",
	"#ff7a5c",
	"#f6b100",
	"#00a38c",
	"#2d6cdf",
	"#8f4ae6",
	"#f43f5e"
];

const BASE_WIDTH = 800;
const ASPECT_RATIO = 0.58;
const BASE_HEIGHT = BASE_WIDTH * ASPECT_RATIO;

const SHAPE_TOOLS = ["line", "rectangle", "circle"];

function resolvePointer(canvas, event) {
	if (event?.scenePoint && typeof event.scenePoint.x === "number") {
		return event.scenePoint;
	}

	if (event?.pointer && typeof event.pointer.x === "number") {
		return event.pointer;
	}

	if (event?.absolutePointer && typeof event.absolutePointer.x === "number") {
		return event.absolutePointer;
	}

	if (event?.e && typeof canvas?.getPointer === "function") {
		return canvas.getPointer(event.e);
	}

	return null;
}

function getDrawPermission(gameState) {
	return Boolean(
		gameState?.isPresenter &&
			gameState?.status === "in-round" &&
			typeof gameState?.word === "string" &&
			gameState.word.trim()
	);
}

export default function DrawingBoard({ socket, gameState, onError }) {
	const canvasElementRef = useRef(null);
	const canvasContainerRef = useRef(null);
	const fabricCanvasRef = useRef(null);
	const isApplyingRemoteRef = useRef(false);
	const pendingUpdateTimeoutRef = useRef(null);
	const latestCanvasVersionRef = useRef(0);
	const lastCanvasSizeRef = useRef({ width: 0, height: 0 });
	const historyRef = useRef([]);
	const historyIndexRef = useRef(-1);
	const isPointerDownRef = useRef(false);
	const activeShapeRef = useRef(null);
	const shapeStartRef = useRef(null);
	const isShiftPressedRef = useRef(false);

	const [brushColor, setBrushColor] = useState(DEFAULT_BRUSH_COLOR);
	const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
	const [toolMode, setToolMode] = useState("draw");
	const [canUndo, setCanUndo] = useState(false);
	const [canRedo, setCanRedo] = useState(false);

	const canDraw = useMemo(() => getDrawPermission(gameState), [gameState]);
	const isShapeToolActive = SHAPE_TOOLS.includes(toolMode);

	const reportError = useCallback((message) => {
		if (!message || typeof onError !== "function") return;
		onError(message);
	}, [onError]);

    const syncCanvasLayout = useCallback(() => {
        const canvas = fabricCanvasRef.current;
        const container = canvasContainerRef.current;
        if (!canvas || !container) return;

        const styles = window.getComputedStyle(container);
        const horizontalPadding =
            (parseFloat(styles.paddingLeft || "0") || 0) +
            (parseFloat(styles.paddingRight || "0") || 0);

        const availableWidth = Math.max(0, container.clientWidth - horizontalPadding);
        const physicalWidth = Math.max(320, Math.floor(availableWidth));
        
        const zoomScale = physicalWidth / BASE_WIDTH;
        const physicalHeight = BASE_HEIGHT * zoomScale;

        lastCanvasSizeRef.current = { width: physicalWidth, height: physicalHeight };

        canvas.setDimensions({ width: physicalWidth, height: physicalHeight });
        canvas.setZoom(zoomScale);
        canvas.renderAll();
    }, []);

	const updateHistoryFlags = useCallback(() => {
		const index = historyIndexRef.current;
		const total = historyRef.current.length;
		setCanUndo(index > 0);
		setCanRedo(index >= 0 && index < total - 1);
	}, []);

	const saveHistorySnapshot = useCallback((canvas, { reset = false } = {}) => {
		const snapshot = canvas.toJSON();
		const snapshotText = JSON.stringify(snapshot);

		if (reset || historyIndexRef.current < 0) {
			historyRef.current = [snapshot];
			historyIndexRef.current = 0;
			updateHistoryFlags();
			return;
		}

		const activeSnapshot = historyRef.current[historyIndexRef.current];
		if (activeSnapshot && JSON.stringify(activeSnapshot) === snapshotText) {
			updateHistoryFlags();
			return;
		}

		if (historyIndexRef.current < historyRef.current.length - 1) {
			historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
		}

		historyRef.current.push(snapshot);
		historyIndexRef.current = historyRef.current.length - 1;
		updateHistoryFlags();
	}, [updateHistoryFlags]);

	const emitCanvasUpdate = useCallback((canvas) => {
		if (!socket) return;
		socket.emit("game:canvas:update", { canvas: canvas.toJSON() }, (res) => {
			if (res?.ok === false) {
				reportError(res?.error || "Unable to sync drawing");
			}
		});
	}, [socket, reportError]);

	const flushCanvasUpdate = useCallback((canvas) => {
		if (!canvas || !canDraw || isApplyingRemoteRef.current) return;
		saveHistorySnapshot(canvas);
		emitCanvasUpdate(canvas);
	}, [canDraw, emitCanvasUpdate, saveHistorySnapshot]);

	const getShiftConstrainedPoint = useCallback((start, pointer, tool) => {
		if (!isShiftPressedRef.current || !start || !pointer) {
			return pointer;
		}

		const dx = pointer.x - start.x;
		const dy = pointer.y - start.y;

		if (tool === "line") {
			const angle = Math.atan2(dy, dx);
			const snapStep = Math.PI / 4;
			const snappedAngle = Math.round(angle / snapStep) * snapStep;
			const length = Math.hypot(dx, dy);
			return {
				x: start.x + Math.cos(snappedAngle) * length,
				y: start.y + Math.sin(snappedAngle) * length
			};
		}

		if (tool === "rectangle") {
			const size = Math.max(Math.abs(dx), Math.abs(dy));
			return {
				x: start.x + Math.sign(dx || 1) * size,
				y: start.y + Math.sign(dy || 1) * size
			};
		}

		return pointer;
	}, []);

	const finalizeActiveStroke = useCallback((canvas) => {
		if (
			!canvas ||
			!isPointerDownRef.current ||
			!canDraw ||
			isApplyingRemoteRef.current ||
			SHAPE_TOOLS.includes(toolMode)
		) {
			return;
		}

		isPointerDownRef.current = false;

		const eventPayload = { e: new MouseEvent("mouseup", { bubbles: true }) };

		if (typeof canvas._onMouseUpInDrawingMode === "function") {
			canvas._onMouseUpInDrawingMode(eventPayload);
		} else if (typeof canvas.__onMouseUp === "function") {
			canvas.__onMouseUp(eventPayload);
		} else if (typeof canvas._onMouseUp === "function") {
			canvas._onMouseUp(eventPayload);
		} else if (canvas.freeDrawingBrush && typeof canvas.freeDrawingBrush._finalizeAndAddPath === "function") {
			canvas.freeDrawingBrush._finalizeAndAddPath();
		}

		canvas.renderAll();

		requestAnimationFrame(() => {
			flushCanvasUpdate(canvas);
		});
	}, [canDraw, flushCanvasUpdate, toolMode]);

	const applySnapshot = useCallback(async (snapshot) => {
		const canvas = fabricCanvasRef.current;
		if (!canvas || !snapshot) return;

		isApplyingRemoteRef.current = true;
		try {
			canvas.clear();
			canvas.backgroundColor = "#ffffff";
			const loadResult = canvas.loadFromJSON(snapshot);
			if (loadResult && typeof loadResult.then === "function") {
				await loadResult;
			}

            syncCanvasLayout();
			canvas.forEachObject((obj) => {
				obj.selectable = false;
				obj.evented = false;
			});
			canvas.renderAll();
		} catch {
			reportError("Unable to apply canvas state");
		} finally {
			isApplyingRemoteRef.current = false;
		}
	}, [reportError, syncCanvasLayout]);

	useEffect(() => {
		if (!canvasElementRef.current) return undefined;

		const instance = new Canvas(canvasElementRef.current, {
			isDrawingMode: false,
			selection: false,
			backgroundColor: "#ffffff"
		});

		instance.freeDrawingBrush = new PencilBrush(instance);

		fabricCanvasRef.current = instance;

		syncCanvasLayout();
		saveHistorySnapshot(instance, { reset: true });

		const resizeObserver = new ResizeObserver(() => {
			syncCanvasLayout();
		});

		if (canvasContainerRef.current) {
			resizeObserver.observe(canvasContainerRef.current);
		}

		return () => {
			if (pendingUpdateTimeoutRef.current) {
				clearTimeout(pendingUpdateTimeoutRef.current);
			}
			resizeObserver.disconnect();
			instance.dispose();
			fabricCanvasRef.current = null;
		};
	}, [saveHistorySnapshot, syncCanvasLayout]);

	useEffect(() => {
		const canvas = fabricCanvasRef.current;
		if (!canvas) return;

		if (!canvas.freeDrawingBrush) {
			canvas.freeDrawingBrush = new PencilBrush(canvas);
		}

		canvas.isDrawingMode = canDraw && (toolMode === "draw" || toolMode === "erase");
		canvas.selection = false;
		canvas.skipTargetFind = true;
        canvas.defaultCursor = canDraw ? "crosshair" : "default";

		if (canvas.freeDrawingBrush) {
			canvas.freeDrawingBrush.color = toolMode === "erase" ? "#ffffff" : brushColor;
			canvas.freeDrawingBrush.width = Number(brushSize);
		}

		canvas.forEachObject((obj) => {
			obj.selectable = false;
			obj.evented = false;
		});

		canvas.renderAll();
	}, [brushColor, brushSize, canDraw, toolMode]);

	useEffect(() => {
		const handleKeyDown = (event) => {
			if (event.key === "Shift") {
				isShiftPressedRef.current = true;
			}
		};

		const handleKeyUp = (event) => {
			if (event.key === "Shift") {
				isShiftPressedRef.current = false;
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
			isShiftPressedRef.current = false;
		};
	}, []);

    // Handle local drawing changes and emit updates to server with debounce
	useEffect(() => {
		if (!socket) return undefined;

		const canvas = fabricCanvasRef.current;
		if (!canvas) return undefined;

		const handlePathCreated = () => {

			if (!canDraw || isApplyingRemoteRef.current) return;

			if (pendingUpdateTimeoutRef.current) {
				clearTimeout(pendingUpdateTimeoutRef.current);
			}

			pendingUpdateTimeoutRef.current = setTimeout(() => {
				saveHistorySnapshot(canvas);
				emitCanvasUpdate(canvas);
			}, UPDATE_DEBOUNCE_MS);
		};

		const updateActiveShape = (pointer) => {
			if (!isPointerDownRef.current || !isShapeToolActive || !activeShapeRef.current) {
				return;
			}

			const start = shapeStartRef.current;
			if (!start) return;

			const constrainedPoint = getShiftConstrainedPoint(start, pointer, toolMode);
			if (!constrainedPoint) return;

			const currentX = Math.round(constrainedPoint.x);
			const currentY = Math.round(constrainedPoint.y);

			if (toolMode === "line") {
				activeShapeRef.current.set({ x2: currentX, y2: currentY });
			}

			if (toolMode === "rectangle") {
				const dx = currentX - start.x;
				const dy = currentY - start.y;
				const width = Math.max(1, Math.abs(dx));
				const height = Math.max(1, Math.abs(dy));
				activeShapeRef.current.set({
					left: start.x + dx / 2,
					top: start.y + dy / 2,
					width,
					height,
					originX: "center",
					originY: "center"
				});
			}

			if (toolMode === "circle") {
				const dx = currentX - start.x;
				const dy = currentY - start.y;
				const rx = Math.max(1, Math.abs(dx) / 2);
				const ry = Math.max(1, Math.abs(dy) / 2);
				activeShapeRef.current.set({
					left: start.x + dx / 2,
					top: start.y + dy / 2,
					rx,
					ry,
					originX: "center",
					originY: "center"
				});
			}

			activeShapeRef.current.setCoords();
			canvas.requestRenderAll();
		};

		const handleMouseDown = (event) => {
			if (!canDraw || isApplyingRemoteRef.current) return;

			if (!isShapeToolActive) {
				isPointerDownRef.current = true;
				return;
			}

			const pointer = resolvePointer(canvas, event);
			if (!pointer) return;

			const startX = Math.round(pointer.x);
			const startY = Math.round(pointer.y);
			shapeStartRef.current = { x: startX, y: startY };
			isPointerDownRef.current = true;

			const commonOptions = {
				stroke: brushColor,
				strokeWidth: brushSize,
				strokeUniform: true,
				strokeLineCap: "round",
				strokeLineJoin: "round",
				fill: "transparent",
				opacity: 1,
				objectCaching: false,
				selectable: false,
				evented: false
			};

			if (toolMode === "line") {
				activeShapeRef.current = new Line(
					[startX, startY, startX, startY],
					commonOptions
				);
			} else if (toolMode === "rectangle") {
				activeShapeRef.current = new Rect({
					...commonOptions,
					left: startX,
					top: startY,
					originX: "center",
					originY: "center",
					width: 1,
					height: 1
				});
			} else if (toolMode === "circle") {
				activeShapeRef.current = new Ellipse({
					...commonOptions,
					left: startX,
					top: startY,
					originX: "center",
					originY: "center",
					rx: 0.5,
					ry: 0.5,
					scaleX: 1,
					scaleY: 1
				});
			}

			if (activeShapeRef.current) {
				canvas.add(activeShapeRef.current);
				canvas.requestRenderAll();
			}
		};

		const handleMouseMove = (event) => {
			const pointer = resolvePointer(canvas, event);
			if (!pointer) return;
			updateActiveShape(pointer);
		};

		const handleWindowPointerMove = (event) => {
			if (!isPointerDownRef.current || !isShapeToolActive || !activeShapeRef.current) {
				return;
			}

			const upper = canvas.upperCanvasEl;
			if (!upper) return;

			const rect = upper.getBoundingClientRect();
			if (!rect.width || !rect.height) return;

			const relX = event.clientX - rect.left;
			const relY = event.clientY - rect.top;
			const pointer = {
				x: (relX / rect.width) * canvas.getWidth(),
				y: (relY / rect.height) * canvas.getHeight()
			};

			updateActiveShape(pointer);
		};

		const finalizeShape = () => {
			if (!activeShapeRef.current || !isShapeToolActive) {
				isPointerDownRef.current = false;
				shapeStartRef.current = null;
				return;
			}

			const activeShape = activeShapeRef.current;
			activeShapeRef.current = null;
			shapeStartRef.current = null;
			isPointerDownRef.current = false;

			if (toolMode === "line") {
				const x1 = activeShape.x1 || 0;
				const y1 = activeShape.y1 || 0;
				const x2 = activeShape.x2 || 0;
				const y2 = activeShape.y2 || 0;
				if (Math.hypot(x2 - x1, y2 - y1) < 2) {
					canvas.remove(activeShape);
				}
			}

			if (toolMode === "rectangle") {
				if ((activeShape.width || 0) < 2 || (activeShape.height || 0) < 2) {
					canvas.remove(activeShape);
				}
			}

			if (toolMode === "circle") {
				if ((activeShape.rx || 0) < 2 && (activeShape.ry || 0) < 2) {
					canvas.remove(activeShape);
				}
			}

			canvas.requestRenderAll();
			flushCanvasUpdate(canvas);
		};

		const handleMouseUp = () => {
			if (isShapeToolActive) {
				finalizeShape();
				return;
			}
			finalizeActiveStroke(canvas);
		};

		const handleMouseOut = () => {
			if (isShapeToolActive) {
				// Keep shape active when pointer leaves canvas; finalize on global pointerup.
				return;
			}
			// For free draw, do not auto-finalize on canvas leave.
			// Finalization happens on window pointerup/blur instead.
		};

		const handleWindowPointerUp = () => {
			if (isShapeToolActive) {
				finalizeShape();
				return;
			}
			finalizeActiveStroke(canvas);
		};

		const handleWindowBlur = () => {
			if (isShapeToolActive) {
				finalizeShape();
				return;
			}
			finalizeActiveStroke(canvas);
		};

		canvas.on("path:created", handlePathCreated);
		canvas.on("mouse:down", handleMouseDown);
		canvas.on("mouse:move", handleMouseMove);
		canvas.on("mouse:up", handleMouseUp);
		canvas.on("mouse:out", handleMouseOut);

		window.addEventListener("pointerup", handleWindowPointerUp);
		window.addEventListener("mouseup", handleWindowPointerUp);
		window.addEventListener("touchend", handleWindowPointerUp);
		window.addEventListener("pointermove", handleWindowPointerMove);
		window.addEventListener("blur", handleWindowBlur);

		const upperCanvas = canvas.upperCanvasEl;
		void upperCanvas;

		return () => {
			canvas.off("path:created", handlePathCreated);
			canvas.off("mouse:down", handleMouseDown);
			canvas.off("mouse:move", handleMouseMove);
			canvas.off("mouse:up", handleMouseUp);
			canvas.off("mouse:out", handleMouseOut);

			window.removeEventListener("pointerup", handleWindowPointerUp);
			window.removeEventListener("mouseup", handleWindowPointerUp);
			window.removeEventListener("touchend", handleWindowPointerUp);
			window.removeEventListener("pointermove", handleWindowPointerMove);
			window.removeEventListener("blur", handleWindowBlur);

			isPointerDownRef.current = false;
			activeShapeRef.current = null;
			shapeStartRef.current = null;
			if (pendingUpdateTimeoutRef.current) {
				clearTimeout(pendingUpdateTimeoutRef.current);
			}
		};
	}, [socket, canDraw, emitCanvasUpdate, saveHistorySnapshot, finalizeActiveStroke, isShapeToolActive, toolMode, brushColor, brushSize, flushCanvasUpdate, getShiftConstrainedPoint]); 

	useEffect(() => {
		if (!socket) return undefined;

		const canvas = fabricCanvasRef.current;
		if (!canvas) return undefined;

		const applyRemoteCanvas = async (payload = {}) => {
			const incomingVersion = Number(payload.version) || 0;
			if (incomingVersion < latestCanvasVersionRef.current) return;
			latestCanvasVersionRef.current = incomingVersion;

			if (pendingUpdateTimeoutRef.current) {
				clearTimeout(pendingUpdateTimeoutRef.current);
			}

			isApplyingRemoteRef.current = true;
			try {
				canvas.clear();
				canvas.backgroundColor = "#ffffff";

				if (payload.canvas) {
					const loadResult = canvas.loadFromJSON(payload.canvas);
					if (loadResult && typeof loadResult.then === "function") {
						await loadResult;
					}
				}

                syncCanvasLayout();

				canvas.forEachObject((obj) => {
					obj.selectable = false;
					obj.evented = false;
				});

				canvas.renderAll();

				if (!canDraw || historyRef.current.length === 0) {
					saveHistorySnapshot(canvas, { reset: true });
				}
			} catch {
				reportError("Unable to apply remote canvas state");
			} finally {
				isApplyingRemoteRef.current = false;
			}
		};

		const handleCanvasState = (payload) => {
			// Presenter already has the local source of truth. Ignore echoed updates
			// while drawing to avoid wiping an in-progress stroke.
			if (canDraw && (payload?.reason === "update" || isPointerDownRef.current)) {
				return;
			}
			void applyRemoteCanvas(payload);
		};

		socket.on("game:canvasState", handleCanvasState);
		socket.emit("game:canvas:sync", {}, (res) => {
			if (res?.ok === false) {
				reportError(res?.error || "Unable to sync canvas");
			}
		});

		return () => {
			socket.off("game:canvasState", handleCanvasState);
		};
	}, [socket, reportError, saveHistorySnapshot, canDraw, syncCanvasLayout]);

	function handleClearCanvas() {
		if (!socket || !canDraw) return;

		if (pendingUpdateTimeoutRef.current) {
			clearTimeout(pendingUpdateTimeoutRef.current);
		}

		socket.emit("game:canvas:clear", {}, (res) => {
			if (res?.ok === false) {
				reportError(res?.error || "Unable to clear canvas");
				return;
			}
			saveHistorySnapshot(fabricCanvasRef.current, { reset: true });
		});
	}

	async function stepHistory(direction) {
		if (!canDraw) return;
		const nextIndex = historyIndexRef.current + direction;
		if (nextIndex < 0 || nextIndex >= historyRef.current.length) return;

		historyIndexRef.current = nextIndex;
		updateHistoryFlags();
		await applySnapshot(historyRef.current[nextIndex]);

		const canvas = fabricCanvasRef.current;
		if (canvas) {
			emitCanvasUpdate(canvas);
		}
	}

	function handleUndo() {
		return stepHistory(-1);
	}

	function handleRedo() {
		return stepHistory(1);
	}

	return (
		<div className="drawing-board grid">
			<div className="canvas-frame" ref={canvasContainerRef}>
				<canvas ref={canvasElementRef} />
			</div>

			{canDraw ? (
				<div className="drawing-toolbar card">
					<div className="palette-grid" role="group" aria-label="Canvas tools">
						<button
							type="button"
							className={toolMode === "draw" ? "palette-btn active" : "palette-btn"}
							onClick={() => setToolMode("draw")}
							aria-label="Brush tool"
							title="Brush"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M4 18c0-2.2 1.8-4 4-4h2l6-6a2 2 0 0 1 2.8 2.8l-6 6v2a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
							</svg>
						</button>
						<button
							type="button"
							className={toolMode === "line" ? "palette-btn active" : "palette-btn"}
							onClick={() => setToolMode("line")}
							aria-label="Line tool"
							title="Line"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<line x1="5" y1="19" x2="19" y2="5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
							</svg>
						</button>
						<button
							type="button"
							className={toolMode === "rectangle" ? "palette-btn active" : "palette-btn"}
							onClick={() => setToolMode("rectangle")}
							aria-label="Rectangle tool"
							title="Rectangle"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<rect x="4" y="6" width="16" height="12" fill="none" stroke="currentColor" strokeWidth="2" rx="1" />
							</svg>
						</button>
						<button
							type="button"
							className={toolMode === "circle" ? "palette-btn active" : "palette-btn"}
							onClick={() => setToolMode("circle")}
							aria-label="Circle tool"
							title="Circle"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
							</svg>
						</button>
						<button
							type="button"
							className={toolMode === "erase" ? "palette-btn active" : "palette-btn"}
							onClick={() => setToolMode("erase")}
							aria-label="Eraser tool"
							title="Eraser"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="m6 14 6-6 6 6-5 5H8l-2-2a2 2 0 0 1 0-3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
								<line x1="14" y1="19" x2="21" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
							</svg>
						</button>
						<button
							type="button"
							className="palette-btn"
							onClick={handleUndo}
							disabled={!canUndo}
							aria-label="Undo"
							title="Undo"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M9 7 4 12l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
								<path d="M20 12H4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
							</svg>
						</button>
						<button
							type="button"
							className="palette-btn"
							onClick={handleRedo}
							disabled={!canRedo}
							aria-label="Redo"
							title="Redo"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="m15 7 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
								<path d="M4 12h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
							</svg>
						</button>
						<button
							type="button"
							className="palette-btn"
							onClick={handleClearCanvas}
							aria-label="Clear canvas"
							title="Clear"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="m6 8 5-5h7l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
								<path d="m6 8 7 13h7L13 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</button>
					</div>

					<div className="palette-controls-row">
						<div className="palette-color-block">
							<label className="color-tile" style={{ "--picked": brushColor }} title="Custom color">
								<input
									type="color"
									value={brushColor}
									onChange={(event) => setBrushColor(event.target.value)}
									disabled={toolMode === "erase"}
									aria-label="Pick color"
								/>
							</label>

							<div className="color-presets palette-colors" role="group" aria-label="Quick colors">
								{PRESET_COLORS.map((color) => (
									<button
										type="button"
										key={color}
										className={brushColor === color ? "swatch active" : "swatch"}
										style={{ "--swatch": color }}
										onClick={() => {
											setToolMode("draw");
											setBrushColor(color);
										}}
										aria-label={`Use color ${color}`}
										title={`Color ${color}`}
									/>
								))}
							</div>
						</div>

						<div className="size-dots" role="group" aria-label="Brush size">
							{[2, 6, 12, 20].map((size) => (
								<button
									type="button"
									key={size}
									className={brushSize === size ? "size-dot active" : "size-dot"}
									onClick={() => setBrushSize(size)}
									aria-label={`Set brush size to ${size}`}
									title={`Size ${size}`}
								>
									<span style={{ "--dot": `${Math.max(4, size)}px` }} />
								</button>
							))}
						</div>
					</div>

				</div>
			) : null}
		</div>
	);
}
