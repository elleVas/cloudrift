// SPDX-License-Identifier: Apache-2.0
import { iamPolicyCommand } from './iam-policy.command';
import { REQUIRED_IAM_POLICY } from '../iam-policy';

describe('iamPolicyCommand', () => {
  it('prints the required IAM policy as pretty-printed JSON', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    iamPolicyCommand();

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(REQUIRED_IAM_POLICY, null, 2));
    logSpy.mockRestore();
  });
});
