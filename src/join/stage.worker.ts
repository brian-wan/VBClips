import { serveStaging } from './stageCopy'

serveStaging(self, () => navigator.storage.getDirectory())
