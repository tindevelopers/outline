import invariant from "invariant";
import { action, computed, runInAction } from "mobx";
import ApiKey from "~/models/ApiKey";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";
import Store, { RPCAction } from "./base/Store";

export default class ApiKeysStore extends Store<ApiKey> {
  actions = [RPCAction.List, RPCAction.Create, RPCAction.Delete];

  constructor(rootStore: RootStore) {
    super(rootStore, ApiKey);
  }

  @computed
  get personalApiKeys() {
    const userId = this.rootStore.auth.user?.id;
    return userId
      ? this.orderedData.filter((key) => key.userId === userId)
      : [];
  }

  /**
   * Rotates the secret of an API key in place.
   *
   * @param apiKey The API key to regenerate.
   * @param options.gracePeriod Whether to keep the replaced secret valid for a period, so consumers can be updated.
   * @returns the updated API key, including the new plain text value.
   */
  @action
  regenerate = async (
    apiKey: ApiKey,
    options: { gracePeriod: boolean }
  ): Promise<ApiKey> => {
    this.isSaving = true;

    try {
      const res = await client.post(`/${this.apiEndpoint}.regenerate`, {
        id: apiKey.id,
        ...options,
      });

      return runInAction(() => {
        invariant(res?.data, "Data should be available");
        this.addPolicies(res.policies);
        return this.add(res.data);
      });
    } finally {
      this.isSaving = false;
    }
  };
}
