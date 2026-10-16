<script lang="ts">
  import { icons, type IconName } from "./index";

  export let name: IconName;
  export let size = "1.1em";
</script>

<span class="icon" style="width: {size}; height: {size};">
  {@html icons[name]}
</span>

<style>
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: currentColor;
  }
  .icon :global(svg) {
    width: 100%;
    height: 100%;
  }
  .icon :global(svg *) {
    vector-effect: non-scaling-stroke;
  }
</style>
