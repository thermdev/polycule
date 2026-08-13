import { uploadImageFile } from '../api.js';
import { updateBackground, updateLayout, useStore } from '../state/store.js';
import { Button, ColorField, Field, ImagePicker, Segmented, Slider } from './ui.jsx';

const BACKGROUND_MODES = [
  { value: 'solid', label: 'Solid' },
  { value: 'stars', label: 'Space' },
  { value: 'texture', label: 'Sky map' },
];

export function ScenePanel({ sceneRef }) {
  const background = useStore((s) => s.graph.background);
  const layout = useStore((s) => s.graph.layout);

  async function handleSkyImage(file) {
    // Sky maps wrap the whole scene, so they keep much more resolution.
    const url = await uploadImageFile(file, { maxSize: 4096 });
    updateBackground({ textureUrl: url, mode: 'texture' });
  }

  return (
    <div className="panel-body">
      <section className="sub-section">
        <h3>Background</h3>
        <Segmented
          value={background.mode}
          onChange={(value) => updateBackground({ mode: value })}
          options={BACKGROUND_MODES}
        />

        {background.mode !== 'texture' ? (
          <ColorField
            label={background.mode === 'stars' ? 'Deep space colour' : 'Background colour'}
            value={background.color}
            onChange={(value) => updateBackground({ color: value })}
          />
        ) : null}

        {background.mode === 'stars' ? (
          <>
            <Slider
              label="Star count"
              min={0}
              max={20000}
              step={250}
              value={background.starCount}
              onChange={(value) => updateBackground({ starCount: value })}
              format={(value) => value.toLocaleString()}
            />
            <ColorField
              label="Star tint"
              value={background.starColor}
              onChange={(value) => updateBackground({ starColor: value })}
            />
            <p className="panel-note dim">
              Stars sit in real 3D space — fly with <kbd>W</kbd>/<kbd>S</kbd> and they
              parallax around you.
            </p>
          </>
        ) : null}

        {background.mode === 'texture' ? (
          <>
            <Field label="Spherical map" hint="equirectangular 2:1">
              {background.textureUrl ? (
                <img className="sky-preview" src={background.textureUrl} alt="" />
              ) : (
                <p className="panel-note dim">
                  Upload a 2:1 equirectangular image to wrap the whole sky.
                </p>
              )}
            </Field>
            <div className="button-row">
              <ImagePicker
                label={background.textureUrl ? 'Replace map' : 'Upload map'}
                onPick={handleSkyImage}
              />
              {background.textureUrl ? (
                <Button onClick={() => updateBackground({ textureUrl: null, mode: 'solid' })}>
                  Clear
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      <section className="sub-section">
        <h3>Layout</h3>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={!!layout.running}
            onChange={(event) => {
              updateLayout({ running: event.target.checked });
              if (event.target.checked) sceneRef.current?.reheat();
            }}
          />
          <span>Run the force layout</span>
        </label>

        <Slider
          label="Repulsion"
          min={40}
          max={900}
          step={10}
          value={layout.repulsion}
          onChange={(value) => {
            updateLayout({ repulsion: value });
            sceneRef.current?.reheat(0.6);
          }}
          format={(value) => Math.round(value)}
        />
        <Slider
          label="Edge length"
          min={4}
          max={60}
          step={1}
          value={layout.springLength}
          onChange={(value) => {
            updateLayout({ springLength: value });
            sceneRef.current?.reheat(0.6);
          }}
          format={(value) => Math.round(value)}
        />
        <Slider
          label="Edge stiffness"
          min={0.005}
          max={0.4}
          step={0.005}
          value={layout.springStrength}
          onChange={(value) => {
            updateLayout({ springStrength: value });
            sceneRef.current?.reheat(0.6);
          }}
          format={(value) => value.toFixed(3)}
        />
        <Slider
          label="Centre pull"
          min={0}
          max={0.15}
          step={0.001}
          value={layout.gravity}
          onChange={(value) => {
            updateLayout({ gravity: value });
            sceneRef.current?.reheat(0.6);
          }}
          format={(value) => value.toFixed(3)}
        />

        <div className="button-row">
          <Button onClick={() => sceneRef.current?.reheat()}>Re-solve</Button>
          <Button onClick={() => sceneRef.current?.shuffle()}>Scatter</Button>
          <Button onClick={() => sceneRef.current?.frameAll()}>Frame all</Button>
        </div>
      </section>
    </div>
  );
}
